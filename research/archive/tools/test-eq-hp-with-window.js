/**
 * ЗАПИСЬ EQ НАУШНИКОВ ПРИ ОТКРЫТОМ ОКНЕ EQ.
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * EQ наушников не пишется ни напрямую, ни через брекет (проверено).
 * Но через UI стрелки работают.
 *
 * Возможно, MCC при открытом окне EQ держит дополнительный канал —
 * например, отправляет какой-то «включающий» кадр, без которого
 * запись 0xa? игнорируется.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * 1. Проверяем наушники (при подключённых — СТОП).
 * 2. Снимок до (с правильным таймингом Prof: пауза 5 с, окно 16 с).
 * 3. Пробуем ТРИ способа в одном прогоне, при открытом окне EQ:
 *      A. прямая запись 0xa1:03
 *      B. запись внутри брекета 0x11:0x20
 *      C. запись + 0x11:0x05 (save-to-device) — вдруг применяется
 *         только при сохранении
 * 4. После каждого — снимок, сравнение.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники ОБЯЗАТЕЛЬНО отключены: EQ влияет на HP-выход,
 * при подключённых можно повредить слух.
 * Значение ставим 20 (тише текущего 40).
 *
 * Запуск: node src/tools/test-eq-hp-with-window.js
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
  PP_BULK_BEGIN,
  PP_SAVE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
/** Профильный тайминг: окно 16 с, пауза между сессиями 5 с. */
const SNAPSHOT_MS = 16000;
const GAP_MS = 5200;
const SETTLE_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snap() {
  try { h.close(); } catch { /* ok */ }
  await sleep(GAP_MS);
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 не найден');
  h = new HID.HID(dev.path);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lastKeep = Date.now(); }
    await sleep(8);
  }
  return out;
}

function row(map) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => map.get(`a1:${hex2(p)}`)).join(' ');
}

async function main() {
  console.log('=== 0. безопасность ===');
  let s = await snap();
  const hp = s.get('64:06');
  console.log(`  HP джек (0x64:06) = ${hp}`);
  console.log(`  0xa1: ${row(s)}`);
  console.log(`  адресов всего: ${s.size}`);

  if (hp === undefined) {
    console.log('\n  джек не прочитан — снимок неполный, повторяю.');
    s = await snap();
    console.log(`  повтор: HP = ${s.get('64:06')}, адресов ${s.size}`);
  }

  if (s.get('64:06') !== 0) {
    console.log('\n  СТОП: наушники подключены (или джек не читается).');
    console.log('  EQ наушников влияет на выход — не рискую.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }
  console.log('  наушники отключены — безопасно');

  const orig = s.get('a1:03');
  console.log(`\n  исходное 0xa1:03 = ${orig}`);
  if (orig === undefined) {
    console.log('  блок 0xa1 не пришёл — прерываю');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const TARGET = orig === 20 ? 10 : 20;

  // ─── A: прямая запись ───
  console.log(`\n=== A: прямая запись 0xa1:03 = ${TARGET} (окно EQ открыто) ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(SETTLE_MS);
  s = await snap();
  const a = s.get('a1:03');
  console.log(`  стало ${a}  ${a === TARGET ? 'ПРИНЯТО' : 'не принято'}`);
  console.log(`  0xa1: ${row(s)}`);

  // ─── B: внутри брекета ───
  console.log(`\n=== B: брекет bulk push + 0xa1:03 = ${TARGET} ===`);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(250);
  send(0xa1, 0x03, TARGET);
  await sleep(250);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(250);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(SETTLE_MS);
  s = await snap();
  const b = s.get('a1:03');
  console.log(`  стало ${b}  ${b === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── C: запись + save-to-device ───
  console.log(`\n=== C: запись + 0x11:0x05 (save-to-device) ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(300);
  send(0x11, PP_SAVE, 1);
  await sleep(SETTLE_MS);
  s = await snap();
  const c = s.get('a1:03');
  console.log(`  стало ${c}  ${c === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── итог ───
  console.log('\n=== ИТОГ ===');
  console.log(`  A прямая:        ${a === TARGET ? 'РАБОТАЕТ' : 'нет'}  (${a})`);
  console.log(`  B брекет:        ${b === TARGET ? 'РАБОТАЕТ' : 'нет'}  (${b})`);
  console.log(`  C запись+save:   ${c === TARGET ? 'РАБОТАЕТ' : 'нет'}  (${c})`);

  // ─── восстановление ───
  if (s.get('a1:03') !== orig) {
    console.log(`\n=== восстановление 0xa1:03 -> ${orig} ===`);
    send(0xa1, 0x03, orig);
    await sleep(400);
    send(0x11, PP_SAVE, 1);
    await sleep(SETTLE_MS);
  }
  s = await snap();
  console.log(`\nитоговое 0xa1: ${row(s)}`);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
