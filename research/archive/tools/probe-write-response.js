/**
 * ОТВЕТ УСТРОЙСТВА НА ЗАПИСЬ В СТАТИЧЕСКИЙ ПАРАМЕТР.
 *
 * ═══ ЧТО СТРАННО ═══
 *
 * Исторический факт: запись 0x46:02 = -30 ОДНАЖДЫ применилась и держится
 * до сих пор (видна в новых сессиях). Но потом ни -28, ни -30 заново
 * применить не удаётся: чтение всегда возвращает -30.
 *
 * Значит устройство либо отвергает повторную запись того же тега,
 * либо принимает её только в определённом состоянии сессии.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * Открываем сессию, подписываемся, пишем значение И СЛУШАЕМ, не закрывая
 * соединение. Если устройство как-то реагирует на запись — увидим это
 * в потоке (эхо, ACK, событие с тем же тегом).
 *
 * Тестируем последовательно:
 *   1. 0x91:04 = 1000 (EQ частота — не принималась)
 *   2. 0x46:04 = 6    (компрессор Attack)
 *   3. 0x21:04 = 43   (громкость — ТОЧНО принимается, контроль)
 *
 * По контролю поймём, как выглядит «принято» в потоке, и сравним с EQ.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены, проверка перед записью. Компрессор выключен.
 * Значения в допустимых диапазонах. В конце Attack и громкость
 * восстанавливаются.
 *
 * Запуск: node src/tools/probe-write-response.js
 */

import HID from 'node-hid';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

const hex2 = (n) => n.toString(16).padStart(2, '0');
const key = (tt, pp) => `${hex2(tt)}:${hex2(pp)}`;

/** Слушает ms миллисекунд, возвращает {state, log} за это время. */
async function listen(ms) {
  const log = [];
  const state = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      const k = key(f.target, f.prop);
      state.set(k, f.value);
      log.push({ at: Date.now() - t0, k, v: f.value });
    }
    await sleep(5);
  }
  return { state, log };
}

async function main() {
  // ---------- сессия ----------
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  console.log('ждём полный дамп (7 с)…');
  const initial = await listen(7000);
  const hp = initial.state.get('64:06');
  const otg = initial.state.get('62:06');
  console.log(`  адресов ${initial.state.size}, HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён.');
    h.close();
    return;
  }

  const orig = {
    eqFreq: initial.state.get('91:04'),
    compAttack: initial.state.get('46:04'),
    vol: initial.state.get('21:04'),
  };
  console.log(`  исходно: 91:04=${orig.eqFreq}  46:04=${orig.compAttack}  21:04=${orig.vol}`);

  const keepalive = setInterval(() => {
    try {
      send(0x11, 0x24, 1);
    } catch {
      /* ok */
    }
  }, 2000);

  const cases = [
    { name: 'КОНТРОЛЬ громкость', tt: 0x21, pp: 0x04, val: 43, check: '21:04' },
    { name: 'компрессор Attack', tt: 0x46, pp: 0x04, val: 6, check: '46:04' },
    { name: 'EQ частота', tt: 0x91, pp: 0x04, val: 1000, check: '91:04' },
    { name: 'EQ включение', tt: 0x91, pp: 0x01, val: 1, check: '91:01' },
  ];

  console.log('\n=== пишем и слушаем ту же сессию ===');
  for (const c of cases) {
    const before = await listen(300);
    const t = Date.now();
    send(c.tt, c.pp, c.val);
    const after = await listen(2500);

    const echoed = after.log.filter((e) => e.k === c.check);
    const others = after.log.filter((e) => e.k !== c.check);

    console.log(`\n${c.name}: 0x${hex2(c.tt)}:${hex2(c.pp)} -> ${c.val}`);
    console.log(`  эхо по своему тегу: ${echoed.length ? JSON.stringify(echoed) : 'нет'}`);
    console.log(`  других кадров за 2.5 с: ${others.length}`);
    if (others.length) {
      const uniq = [...new Set(others.map((o) => o.k))].slice(0, 8);
      console.log(`    затронуты теги: ${uniq.join(' ')}`);
    }
    const final = after.state.get(c.check);
    console.log(`  итоговое значение ${c.check} = ${final}  ${final === c.val ? '=> ПРИНЯТО' : '=> не принято'}`);
  }

  // ---------- восстановление ----------
  console.log('\n=== восстановление ===');
  if (orig.vol !== undefined) send(0x21, 0x04, orig.vol);
  await sleep(300);
  if (orig.compAttack !== undefined) send(0x46, 0x04, orig.compAttack);
  await sleep(300);
  if (orig.eqFreq !== undefined) send(0x91, 0x04, orig.eqFreq);
  await sleep(300);
  const fin = await listen(1500);
  console.log(`  21:04 = ${fin.state.get('21:04')} (ждали ${orig.vol})`);
  console.log(`  46:04 = ${fin.state.get('46:04')} (ждали ${orig.compAttack})`);
  console.log(`  91:04 = ${fin.state.get('91:04')} (ждали ${orig.eqFreq})`);

  clearInterval(keepalive);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
