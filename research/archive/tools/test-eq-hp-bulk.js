/**
 * EQ НАУШНИКОВ: запись через bulk push?
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * 1. Стрелки на диле EQ наушников МЕНЯЮТ тег: 4 нажатия вверх дали
 *    0xa1:03 = 40 (было 0). Значит связь полоса->блок подтверждена.
 *
 * 2. Прямая запись send(0xa1, 0x03, -3) НЕ применилась — тег остался 40.
 *
 * 3. Для микшера такая же картина: одиночные записи не работали,
 *    а внутри брекета bulk push (0x11:0x20 = 1 ... 0) — работали.
 *
 * Гипотеза: EQ наушников тоже требует bulk push.
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Пишем 0xa1:03 внутри брекета и смотрим, применилось ли.
 * Сравниваем с прямой записью (контроль).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP проверяется: при подключённых наушниках СТОП.
 * Значение ставим 20 (меньше текущего 40) — тише.
 *
 * Запуск: node src/tools/test-eq-hp-bulk.js
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
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
// ВАЖНО: в Prof-режиме между сессиями нужна пауза >= 3 с, окно 16 с.
// Измерено debug-repeat-snap.js: пауза 0 и 0.9 с -> 30 адресов,
// пауза 3 с -> 175 адресов, 0xa1 приходит на ~8.2 с.
const SNAPSHOT_MS = 16000;
const GAP_MS = 5000;
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
  await sleep(380);
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

function vals(map, tt, n = 10) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .slice(0, n)
    .map((p) => map.get(`${tt}:${hex2(p)}`))
    .join(' ');
}

async function main() {
  console.log('=== снимок до ===');
  let s = await snap();
  const hp = s.get('64:06');
  console.log(`  0xa1: ${vals(s, 'a1')}`);
  console.log(`  HP джек: ${hp}`);

  if (hp !== 0) {
    console.log('\n  СТОП: наушники подключены. Отключи и повтори.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const orig = s.get('a1:03');
  console.log(`\n  исходное 0xa1:03 = ${orig}`);

  // ─── тест A: прямая запись (контроль) ───
  const TARGET = orig === 20 ? 10 : 20;
  console.log(`\n=== A: прямая запись 0xa1:03 = ${TARGET} ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(800);
  try { h.close(); } catch { /* ok */ }
  await sleep(4000);
  s = await snap();
  const direct = s.get('a1:03');
  console.log(`  стало: ${direct}  ${direct === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── тест B: внутри брекета ───
  console.log(`\n=== B: запись внутри bulk push ===`);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(200);
  send(0xa1, 0x03, TARGET);
  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(800);
  try { h.close(); } catch { /* ok */ }
  await sleep(4000);
  s = await snap();
  const bulk = s.get('a1:03');
  console.log(`  стало: ${bulk}  ${bulk === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── итог ───
  console.log('\n=== ИТОГ ===');
  console.log(`  прямая запись:     ${direct === TARGET ? 'РАБОТАЕТ' : 'не работает'}`);
  console.log(`  внутри bulk push:  ${bulk === TARGET ? 'РАБОТАЕТ' : 'не работает'}`);

  // ─── восстановление ───
  if (orig !== undefined && s.get('a1:03') !== orig) {
    console.log(`\n=== восстановление 0xa1:03 -> ${orig} ===`);
    send(0x11, PP_BULK_BEGIN, 1);
    await sleep(150);
    send(0xa1, 0x03, orig);
    await sleep(150);
    send(0x11, PP_BULK_BEGIN, 0);
    await sleep(500);
    s = await snap();
    console.log(`  0xa1:03 = ${s.get('a1:03')}`);
  }

  console.log(`\nитоговое 0xa1: ${vals(s, 'a1')}`);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
