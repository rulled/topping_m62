/**
 * ПОЧЕМУ ПОВТОРНЫЙ СНИМОК НЕ ВИДИТ 0xa1.
 *
 * ═══ СИМПТОМ ═══
 *
 * dump-slow.js (окно 22 с, ОДИН снимок) -> 177 адресов, включая 0xa1.
 * test-eq-hp-bulk.js (окно 14 с, ДВА снимка подряд) -> 0xa1 НЕ приходит.
 *
 * Разница: dump-slow делает один снимок на свежем соединении, а
 * test-eq-hp-bulk закрывает и переоткрывает устройство между снимками.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 *   A. Устройство отдаёт 0xa1 только на ПЕРВОМ подключении после
 *      смены режима. Дальше — нет.
 *   B. Нужна большая пауза между сессиями (как для EQ в Live — 500 мс).
 *   C. 0xa1 приходит только когда MCC запущен (он держит сессию).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Делает ТРИ снимка подряд с разными паузами и печатает, что видно.
 *
 * Запуск: node src/tools/debug-repeat-snap.js
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

async function snapOnce(gapMs, listenMs, label) {
  await sleep(gapMs);
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 iface 4 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const state = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  let firstA1 = null;
  while (Date.now() - t0 < listenMs) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      state.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      if (firstA1 === null && f.target === 0xa1) firstA1 = Date.now() - t0;
    }
    if (Date.now() - lastKeep >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lastKeep = Date.now(); }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  const a1 = [...state.keys()].filter((k) => k.startsWith('a1:')).length;
  console.log(
    `  ${label}: всего ${String(state.size).padStart(3)}, 0xa1 ${String(a1).padStart(2)} тегов` +
      (firstA1 !== null ? `, первый на ${firstA1} мс` : ''),
  );
  return { state, a1 };
}

async function main() {
  console.log('=== три снимка подряд, разные паузы ===');
  await snapOnce(0, 16000, 'снимок 1 (пауза 0, окно 16 с)');
  await snapOnce(900, 16000, 'снимок 2 (пауза 0.9 с, окно 16 с)');
  await snapOnce(3000, 16000, 'снимок 3 (пауза 3 с, окно 16 с)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
