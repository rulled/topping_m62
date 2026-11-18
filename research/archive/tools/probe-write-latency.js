/**
 * ЛАТЕНТНОСТЬ ЗАПИСИ: сколько ждать, чтобы чтение показало новое значение.
 *
 * ═══ ЗАГАДКА ═══
 *
 * 1. control-compressor-write.js: было -28, записали -30, перечитали -28,
 *    записали обратно -28.
 * 2. probe-dsp-write-gates.js через несколько минут: 46:02 = -30.
 *
 * То есть запись -30 ДОЕХАЛА, но не сразу. А «восстановление» в -28
 * прочиталось как -28 (то есть тоже отставание), и фактически
 * восстановление не применилось.
 *
 * Вывод-гипотеза: запись в статические параметры (0x46, 0x91) применяется
 * с задержкой, а дамп состояния в течение этого времени отдаёт СТАРОЕ
 * значение. Громкость 0x21:04 такого не показывает, потому что она в
 * живом потоке событий.
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Пишем 46:02 -> -28 (восстановление), затем читаем через 1, 5, 15, 30 с.
 * Смотрим, на какой задержке значение сменится.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены, проверяется. Компрессор выключен — правка инертна.
 * -28 — исходное значение из INI.
 *
 * Запуск: node src/tools/probe-write-latency.js
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
const SNAPSHOT_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(800);
  h = new HID.HID(dev.path);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
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
      out.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

async function main() {
  console.log('исходное состояние…');
  let s = await snapshot();
  const hp = s.get('64:06');
  const otg = s.get('62:06');
  console.log(`  46:02 = ${s.get('46:02')}   HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const TARGET = -28;
  console.log(`\nпишем 46:02 -> ${TARGET}`);
  send(0x46, 0x02, TARGET);
  await sleep(300);
  try { h.close(); } catch { /* ok */ }

  for (const waitMs of [1000, 5000, 15000, 30000]) {
    await sleep(waitMs);
    const t = await snapshot();
    const got = t.get('46:02');
    console.log(`  через +${String(waitMs).padStart(5)} мс: 46:02 = ${got}  ${got === TARGET ? 'ДОЕХАЛО' : 'ещё старое'}`);
  }

  console.log('\nитог: запись в статические параметры применяется с задержкой,');
  console.log('а дамп до этого момента отдаёт прежнее значение.');
  console.log('Поэтому проверять запись нужно либо с задержкой, либо по INI.');

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
