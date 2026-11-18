/**
 * ЧТО ТАКОЕ 0x11:0x18?
 *
 * Гипотеза была: "счётчик изменений настроек".
 * Но он растёт сам по себе (96->97->98->99) без изменений настроек.
 *
 * Проверяем:
 *   1) растёт ли он БЕЗ ANNOUNCE (только слушаем поток)
 *   2) как быстро растёт
 *   3) меняется ли при реальном изменении настройки
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
if (!found.length) { console.log('устройство не найдено'); process.exit(1); }
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', () => {});

const seen = new Map();
const arrivals = [];  // время прихода 0x1118

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const key = (m.target << 8) | m.prop;
  // фиксируем приход счётчика
  if (key === 0x1118) arrivals.push({ t: Date.now(), v: m.value });
  seen.set(key, m.value);
});

console.log('═══ 1. СЛУШАЮ БЕЗ ANNOUNCE (10 секунд) ═══');
await sleep(10000);
console.log(`  приходов 0x1118: ${arrivals.length}`);
for (const a of arrivals.slice(0, 10)) {
  console.log(`    значение ${a.v}`);
}
if (arrivals.length === 0) {
  console.log('  (сам по себе не приходит — нужен ANNOUNCE)');
}

console.log('\n═══ 2. ДЕЛАЮ ОДИН ANNOUNCE ═══');
arrivals.length = 0;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);
console.log(`  приходов 0x1118 после ANNOUNCE: ${arrivals.length}`);
for (const a of arrivals) console.log(`    значение ${a.v}`);

console.log('\n═══ 3. ЖДУ 15 СЕКУНД БЕЗ ANNOUNCE ═══');
arrivals.length = 0;
await sleep(15000);
console.log(`  приходов: ${arrivals.length}`);
if (arrivals.length) {
  for (const a of arrivals) console.log(`    значение ${a.v}`);
} else {
  console.log('  не приходит — значит только по запросу');
}

console.log('\n═══ 4. ВТОРОЙ ANNOUNCE, сравниваю ═══');
arrivals.length = 0;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);
console.log(`  приходов: ${arrivals.length}`);
for (const a of arrivals) console.log(`    значение ${a.v}`);

console.log('\n═══ 5. МЕНЯЮ НАСТРОЙКУ (brightness) и смотрю ═══');
const brightBefore = seen.get(0x1104);
console.log(`  brightness было: ${brightBefore}`);
dev.write([...withReportId(buildFrame(0x11, 0x04, brightBefore === 0 ? 1 : 0, true))]);
await sleep(2000);

arrivals.length = 0;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);
console.log(`  после смены brightness=${seen.get(0x1104)}, 0x1118 = ${seen.get(0x1118)}`);
console.log(`  приходов 0x1118: ${arrivals.length}`);

// вернуть brightness
dev.write([...withReportId(buildFrame(0x11, 0x04, brightBefore, true))]);
await sleep(1500);
console.log(`  brightness возвращён в ${brightBefore}`);

dev.close();
process.exit(0);
