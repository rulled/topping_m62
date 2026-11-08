/**
 * ПИШЕТСЯ ЛИ EQ Switch ЧЕРЕЗ HID?
 *
 * Найдены теги: 0x9b:0x0f, 0x9b:0x10, 0x9b:0x12, 0x9b:0x13 (все = 0).
 * Пробуем записать 1 и смотреть на файл.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
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

const eqState = () => {
  const i = readWorkspace(findActiveWorkspace().path);
  return { sw: i.EQ_IN1?.Switch, b1: i.EQ_IN1?.['Eq%401'] };
};

console.log('Load preset1 (чтобы EQ-теги ожили)...');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(6000);

console.log('\n=== ДО ===');
console.log('  файл:', JSON.stringify(eqState()));
for (const pp of [0x0f, 0x10, 0x12, 0x13]) {
  console.log(`  0x9b:0x${pp.toString(16)} = ${seen.get((0x9b << 8) | pp)}`);
}

console.log('\n=== ПРОБУЮ ПИСАТЬ 1 В КАЖДЫЙ ТЕГ ===\n');
const results = [];
for (const pp of [0x0f, 0x10, 0x12, 0x13]) {
  const before = eqState();
  dev.write([...withReportId(buildFrame(0x9b, pp, 1, true))]);
  await sleep(2500);
  const after = eqState();
  const hidVal = seen.get((0x9b << 8) | pp);
  const changed = String(before.sw) !== String(after.sw);
  console.log(`  0x9b:0x${pp.toString(16)} = 1 -> файл Switch: ${before.sw} -> ${after.sw}, HID=${hidVal}  ${changed ? '*** ИЗМЕНИЛОСЬ ***' : 'нет'}`);
  if (changed) results.push(pp);
  if (changed) break;
}

console.log('\n=== ИТОГ ===');
if (results.length) {
  console.log(`  EQ Switch пишется через HID: 0x9b:0x${results[0].toString(16)}`);
} else {
  console.log('  EQ Switch НЕ пишется ни через один из 4 тегов');
  console.log('  (возможно, нужен другой тег или другой режим)');
}

// вернуть 0
console.log('\nвозвращаю 0...');
for (const pp of [0x0f, 0x10, 0x12, 0x13]) {
  dev.write([...withReportId(buildFrame(0x9b, pp, 0, true))]);
  await sleep(400);
}
await sleep(1500);
console.log('файл:', JSON.stringify(eqState()));

dev.close();
