/**
 * EQ НАУШНИКОВ: подтверждение структуры через запись тегов.
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Гипотеза: 0xa1..0xaa = 10 полос EQ наушников, в каждом блоке
 * два набора по 5 полей (L и R канал):
 *
 *     01..05 = левый   (вкл, тип, gain, freq, Q)
 *     06..0a = правый  (то же)
 *
 * Проверка: пишем РАЗНЫЕ значения в 01..05 и 06..0a одного блока,
 * затем переподключаемся и смотрим, сохранились ли они раздельно.
 * Если да — каналы действительно независимы.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP проверяется: если наушники подключены, звук возможен. Но мы пишем
 * только EQ наушников, а он влияет на выход HP. Поэтому:
 *   - если HP ПОДКЛЮЧЁН -> СТОП (не рискуем слухом)
 *   - если отключён -> пишем безопасные значения
 *
 * Gain ставим только отрицательный (тише), частоту и Q оставляем дефолтными.
 *
 * Запуск: node src/tools/verify-eq-hp-structure.js
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
const SNAPSHOT_MS = 7500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snap() {
  try { h.close(); } catch { /* ok */ }
  await sleep(900);
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

function show(label, map) {
  const row = (tt) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map((p) => map.get(`${tt}:${hex2(p)}`))
      .join(' ');
  console.log(`  ${label}`);
  for (const tt of ['a1', 'a2', 'a3']) console.log(`    0x${tt}: ${row(tt)}`);
  console.log(`    HP джек (64:06) = ${map.get('64:06')}`);
}

async function main() {
  console.log('=== снимок до ===');
  let s = await snap();
  show('исходное', s);

  const hp = s.get('64:06');
  if (hp !== 0) {
    console.log(`\n  СТОП: наушники ПОДКЛЮЧЕНЫ (0x64:06 = ${hp}).`);
    console.log('  EQ наушников влияет на выход — не рискую. Отключи наушники.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }
  console.log('\n  наушники отключены — безопасно');

  // ─── пишем разные значения в L и R канал полосы 1 ───
  console.log('\n=== пишем полосу 1 (0xa1): L=-3 дБ, R=-9 дБ ===');
  console.log('  остальные поля оставляем дефолтными');

  // сначала включим полосу (01 и 06 = 1)
  send(0xa1, 0x01, 1);
  await sleep(150);
  send(0xa1, 0x06, 1);
  await sleep(150);
  // gain L = -3, R = -9
  send(0xa1, 0x03, -3);
  await sleep(150);
  send(0xa1, 0x08, -9);
  await sleep(500);

  console.log('\n=== снимок после записи (в той же сессии) ===');
  s = await snap();
  show('после', s);

  const l = s.get('a1:03');
  const r = s.get('a1:08');
  console.log('\n=== проверка ===');
  console.log(`  0xa1:03 (L gain) = ${l}  ${l === -3 ? 'ПРИНЯТО' : 'не принято'}`);
  console.log(`  0xa1:08 (R gain) = ${r}  ${r === -9 ? 'ПРИНЯТО' : 'не принято'}`);

  if (l === -3 && r === -9) {
    console.log('\n  СТРУКТУРА ПОДТВЕРЖДЕНА: каналы L и R независимы.');
    console.log('  Свойства 01..05 = левый, 06..0a = правый.');
  }

  // ─── восстановление ───
  console.log('\n=== восстановление (gain 0, полосы выключены) ===');
  send(0xa1, 0x03, 0);
  await sleep(150);
  send(0xa1, 0x08, 0);
  await sleep(150);
  send(0xa1, 0x01, 0);
  await sleep(150);
  send(0xa1, 0x06, 0);
  await sleep(500);

  s = await snap();
  show('после восстановления', s);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
