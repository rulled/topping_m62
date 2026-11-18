/**
 * МИКШЕР: возвращает ли устройство эхо после записи?
 *
 * ═══ НА ЧЁМ ЭТО ОСНОВАНО ═══
 *
 * Обнаружено (probe-write-response.js): разные семейства тегов ведут себя
 * по-разному после записи.
 *
 *   ГРОМКОСТЬ 0x21:04 -> эхо приходит сразу, 3 кадра с новым значением.
 *                        Поэтому её видно в той же сессии.
 *   EQ 0x91:04, КОМПРЕССОР 0x46:04 -> эха НЕТ. Видно только через
 *                        свежий дамп после переподключения.
 *
 * Микшер (0x31..0x36, property = источник) в дампе НЕ приходит вообще —
 * только метры 0x3x:0x15. Значит проверить запись нечем, кроме эха.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * Пишем в кросспоинт микшера и слушаем ту же сессию: придёт ли кадр
 * с этим же тегом и новым значением.
 *
 * Значения:
 *   Q25: 0 = mute, 2^25 = 33554432 = 0 dB.
 *   Пишем 0 (mute) — это самое безопасное (тише, не громче) и максимально
 *   отличимо от любого текущего значения. В конце восстанавливаем.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены (проверяется перед записью, при подключении СТОП) —
 * звук физически невозможен. IN1 подключён, но это ВХОД.
 * Пишем ТОЛЬКО mute (тише), никогда не громче текущего.
 *
 * Запуск: node src/tools/probe-mixer-echo.js
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

const hex2 = (n) => n.toString(16).padStart(2, '0');
const key = (tt, pp) => `${hex2(tt)}:${hex2(pp)}`;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Слушает ms мс: возвращает {state, log} — все кадры с временем. */
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
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  console.log('полный дамп (7 с)…');
  const init = await listen(7000);
  const hp = init.state.get('64:06');
  const otg = init.state.get('62:06');
  console.log(`  адресов ${init.state.size}, HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён.');
    h.close();
    process.exit(1);
  }

  // какие микшерные адреса вообще видны
  const mixTags = [...init.state.keys()].filter((k) => /^3[1-6]:/.test(k)).sort();
  console.log(`  микшерных тегов в дампе: ${mixTags.length} [${mixTags.join(' ')}]`);

  const keepalive = setInterval(() => {
    try {
      send(0x11, 0x24, 1);
    } catch {
      /* ok */
    }
  }, 2000);

  // ---------- проба эха ----------
  // Целимся в кросспоинты: target = микс + канал, property = источник.
  // Mix A = 0x31/0x32 (L/R), Mix B = 0x33/0x34, Mix C = 0x35/0x36.
  // Источники: 01/02 = Playback 1/2 … 0f/10 = OTG.
  const CASES = [
    { tt: 0x31, pp: 0x01, label: 'Mix A <- Playback 1' },
    { tt: 0x31, pp: 0x09, label: 'Mix A <- IN 1' },
    { tt: 0x33, pp: 0x01, label: 'Mix B <- Playback 1' },
  ];

  console.log('\n=== пишем mute (Q25 = 0) и слушаем эхо 3 с ===');
  const results = [];
  for (const c of CASES) {
    const before = await listen(200);
    send(c.tt, c.pp, 0);
    const after = await listen(3000);

    const echoed = after.log.filter((e) => e.k === key(c.tt, c.pp));
    results.push({ ...c, echoed: echoed.length, sample: echoed[0] });

    console.log(`\n${c.label}  0x${hex2(c.tt)}:${hex2(c.pp)} -> 0`);
    if (echoed.length) {
      console.log(`  эхо: ${echoed.length} кадров, первый ${JSON.stringify(echoed[0])}`);
    } else {
      console.log('  эха нет');
    }
    // не менялось ли что-то ещё рядом
    const near = after.log.filter(
      (e) => /^3[1-6]:/.test(e.k) && e.k !== key(c.tt, c.pp),
    );
    if (near.length) {
      const uniq = [...new Set(near.map((n) => n.k))];
      console.log(`  другие микшерные теги: ${uniq.join(' ')}`);
    }
  }

  // ---------- итог ----------
  console.log('\n=== ИТОГ ===');
  const anyEcho = results.some((r) => r.echoed > 0);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(22)} эхо: ${r.echoed ? 'ДА' : 'нет'}`);
  }

  console.log('');
  if (anyEcho) {
    console.log('=> Микшер отвечает эхом — обратное чтение возможно без USBPcap.');
  } else {
    console.log('=> Эха нет. Кросспоинты не приходят и после записи.');
    console.log('   Значит проверить запись можно только внешним наблюдением:');
    console.log('   USBPcap (нужен админ) или workspace-INI.');
  }

  clearInterval(keepalive);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
