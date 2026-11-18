/**
 * МОЖНО ЛИ ПРОЧИТАТЬ ШКАЛУ Q БЕЗ ВКЛЮЧЕНИЯ EQ?
 *
 * Пробуем: есть ли HID-тег, который пишется и отражается,
 * пока EQ выключен. Проверяем 0x9b-переключатели и 0x91-теги.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
if (!found.length) { console.log('нет устройства'); process.exit(1); }
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

console.log('=== 1. ANNOUNCE (без Load preset) ===');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(4500);
const eqTags1 = [...seen.keys()].filter((k) => (k >> 8) === 0x91 || (k >> 8) === 0x9b).sort((a, b) => a - b);
console.log(`  EQ-тегов: ${eqTags1.length}`);
for (const k of eqTags1) console.log(`    0x${k.toString(16)} = ${seen.get(k)}`);

console.log('\n=== 2. ПРОБУЮ ПИСАТЬ Q НАПРЯМУЮ (0x91:0x05) ===');
const tests = [1.5, 3, 0.5];
for (const q of tests) {
  const raw = Math.round(q * 10000);
  console.log(`  пробую Q=${q} -> raw=${raw}`);
  dev.write([...withReportId(buildFrame(0x91, 0x05, raw, true))]);
  await sleep(1500);

  // перечитываем
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(3500);
  const cur = seen.get((0x91 << 8) | 0x05);
  console.log(`    HID 0x91:0x05 = ${cur}  ${cur === raw ? '✓ ПРИНЯТО' : '✗ не принято'}`);
}

console.log('\n=== 3. ПРОВЕРЯЮ ФАЙЛ ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
console.log(`  Eq%401 = ${ini.EQ_IN1?.['Eq%401']}`);
console.log(`  Switch = ${ini.EQ_IN1?.Switch}`);

dev.close();
