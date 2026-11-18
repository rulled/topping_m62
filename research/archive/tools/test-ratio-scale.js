/**
 * ГИПОТЕЗА: Ratio пишется через HID, но в шкале ×10.
 *
 * Ранее (§44) пробовал 0x4603 = 8 — не сработало.
 * Но HID отдаёт 40 когда в файле 4. Значит для Ratio=8 в файле
 * нужно писать 80 в HID!
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

const ratio = () => {
  const ws = findActiveWorkspace();
  return Number(readWorkspace(ws.path).Compressor?.Ratio);
};

// Сначала Load preset чтобы теги ожили
console.log('1. Load preset1 (чтобы 0x46 ожили)...');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(6000);
cap = seen;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(2500);
cap = null;

console.log(`   файл Ratio = ${ratio()}`);
console.log(`   HID 0x4603 = ${seen.get(0x4603)}`);

// Пробуем записать в шкале ×10
const TESTS = [
  { hid: 80, expectFile: 8, label: 'Ratio=8 (HID 80)' },
  { hid: 60, expectFile: 6, label: 'Ratio=6 (HID 60)' },
  { hid: 40, expectFile: 4, label: 'Ratio=4 (HID 40)' },
];

console.log('\n2. ПРОБУЮ ПИСАТЬ В ШКАЛЕ ×10:\n');
for (const t of TESTS) {
  console.log(`--- ${t.label} ---`);
  dev.write([...withReportId(buildFrame(0x46, 0x03, t.hid, true))]);
  await sleep(2000);

  cap = seen;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(2000);
  cap = null;

  const fileR = ratio();
  const hidR = seen.get(0x4603);
  console.log(`   файл Ratio = ${fileR} (ожидали ${t.expectFile})`);
  console.log(`   HID 0x4603 = ${hidR}`);
  const ok = fileR === t.expectFile;
  console.log(`   ${ok ? '*** СРАБОТАЛО ***' : 'не сработало'}`);
  if (ok) break;
}

dev.close();
process.exit(0);
