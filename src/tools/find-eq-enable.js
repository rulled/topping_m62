/**
 * КАК ВКЛЮЧИТЬ EQ? Switch через файл сбрасывается.
 *
 * Пробуем:
 *   1) HID-тег (может, есть 0x9b:0x0f или подобный)
 *   2) UI-кнопку (может, есть на странице MORE)
 *   3) контекстное меню
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const eqSwitch = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.Switch;

console.log('=== 1. ЧТО ЕСТЬ В HID ПРО EQ ===');
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
dev.on('error', () => {});

const seen = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen.set((m.target << 8) | m.prop, m.value);
});

// Load preset чтобы получить EQ-теги
console.log('  отправляю Load preset1 (чтобы EQ-теги ожили)...');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(6000);

const eqTags = [...seen.keys()].filter((k) => {
  const tt = k >> 8;
  return tt === 0x9b || tt === 0x91 || tt === 0x92 || tt === 0xab || tt === 0xb1;
}).sort((a, b) => a - b);

console.log(`  EQ-тегов в HID: ${eqTags.length}`);
for (const k of eqTags.slice(0, 25)) {
  console.log(`    0x${k.toString(16).padStart(4, '0')} = ${seen.get(k)}`);
}

console.log(`\n  Switch сейчас (файл): ${eqSwitch()}`);

console.log('\n=== 2. ИЩУ КНОПКУ ВКЛЮЧЕНИЯ EQ В UI ===');
const { items } = dumpTree();
console.log(`  элементов: ${items.length}`);

// ищем все кнопки и их имена
const btns = items.filter((x) => x.cls === 'QPushButton' || x.cls === 'QToolButton');
console.log(`  кнопок: ${btns.length}`);

// ищем кнопки рядом с "EQ" подписями
const eqLabels = items.filter((x) => /EQ|eq/i.test(x.name || ''));
console.log(`  подписей с EQ: ${eqLabels.length}`);
for (const l of eqLabels) console.log(`    [${l.i}] ${l.cls} (${l.lx},${l.ly}) "${l.name}"`);

console.log('\n=== 3. все подписи (для поиска EQ-панели) ===');
for (const l of items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).slice(0, 45)) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.slice(0, 30)}"`);
}

dev.close();
