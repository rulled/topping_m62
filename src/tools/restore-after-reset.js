/**
 * ВОССТАНОВЛЕНИЕ НАСТРОЕК после factory reset.
 *
 * Ставим те значения, что были до сброса:
 *   brightness=2 (Bright), otgPower=0 (Off), usbCPower=3 (Off),
 *   autoPower=1 (On), noiseReduction=35, ncType=15
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

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
dev.on('error', (e) => console.log('  HID error:', e.message));

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

console.log('=== ТЕКУЩЕЕ (после сброса) ===');
let s = await snap();
const cur = (tt, pp) => s.get((tt << 8) | pp);
console.log(`  brightness 0x1104 = ${cur(0x11, 0x04)}`);
console.log(`  otgPower   0x111b = ${cur(0x11, 0x1b)}`);
console.log(`  usbCPower  0x111c = ${cur(0x11, 0x1c)}`);
console.log(`  autoPower  0x111e = ${cur(0x11, 0x1e)}`);
console.log(`  noiseRed   0x4406 = ${cur(0x44, 0x06)}`);
console.log(`  ncType     0x4407 = ${cur(0x44, 0x07)}`);

// восстанавливаем в исходные значения
const RESTORE = [
  [0x11, 0x04, 2, 'brightness = 2 (Bright)'],
  [0x11, 0x1b, 0, 'otgPower = 0 (Off)'],
  [0x11, 0x1c, 3, 'usbCPower = 3 (Off)'],
  [0x11, 0x1e, 1, 'autoPower = 1 (On)'],
  [0x44, 0x06, 35, 'noiseRed = 35'],
  [0x44, 0x07, 15, 'ncType = 15'],
];

console.log('\n=== ВОССТАНАВЛИВАЮ ===');
for (const [tt, pp, v, name] of RESTORE) {
  dev.write([...withReportId(buildFrame(tt, pp, v, true))]);
  console.log(`  ${name}`);
  await sleep(500);
}

await sleep(2500);
console.log('\n=== ПОСЛЕ ВОССТАНОВЛЕНИЯ ===');
s = await snap();
let ok = 0;
for (const [tt, pp, v, name] of RESTORE) {
  const now = s.get((tt << 8) | pp);
  const pass = now === v;
  console.log(`  ${name.padEnd(26)} = ${now}  ${pass ? 'OK' : 'FAIL'}`);
  if (pass) ok++;
}
console.log(`\n  восстановлено: ${ok}/${RESTORE.length}`);

dev.close();
process.exit(0);
