/**
 * СНИМОК ПОСЛЕ ПАУЗЫ — когда MCC «успокоится».
 *
 * ═══ НАБЛЮДЕНИЕ ═══
 *
 * test-eq-window-blocks.js: окно EQ было открыто ДАВНО -> снимок дал
 * 176 адресов, 0xa1 на 10.8 с.
 *
 * test-eq-hp-final.js: окно только что открыто (3 с назад) -> 30 адресов,
 * 0xa1 нет.
 *
 * Гипотеза: после открытия окна MCC некоторое время «занят» (строит
 * график, читает состояние), и наш handshake попадает в плохой момент.
 * Нужно подождать 15-20 с после открытия окна.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Ждёт 20 с, потом делает снимок. Если получилось — печатает блок 0xa1.
 *
 * Запуск: node src/tools/snap-after-wait.js
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

async function snap(listenMs, label) {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 не найден');
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
    `  ${label}: ${state.size} адресов, 0xa1 ${a1} тегов` +
      (firstA1 !== null ? `, первый на ${firstA1} мс` : ''),
  );
  if (a1) {
    const row = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => state.get(`a1:${hex2(p)}`)).join(' ');
    console.log(`    0xa1: ${row}`);
    console.log(`    HP: ${state.get('64:06')}`);
  }
  return state;
}

async function main() {
  console.log('=== ждём 20 с, чтобы MCC успокоился ===');
  await sleep(20000);

  console.log('\n=== снимок 1 (26 с) ===');
  const s1 = await snap(26000, 'после паузы');
  if ([...s1.keys()].some((k) => k.startsWith('a1:'))) {
    console.log('\n  УСПЕХ — блок 0xa1 получен');
    return;
  }

  console.log('\n  не пришёл. ждём ещё 30 с и пробуем снова…');
  await sleep(30000);
  const s2 = await snap(26000, 'вторая попытка');
  if ([...s2.keys()].some((k) => k.startsWith('a1:'))) {
    console.log('\n  УСПЕХ со второй попытки');
  } else {
    console.log('\n  блок 0xa1 так и не пришёл');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
