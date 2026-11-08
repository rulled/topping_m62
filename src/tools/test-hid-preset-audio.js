/**
 * Что же восстанавливает HID-пресет? Проверяем на аудио-параметрах.
 *
 * Меняем громкости и FX-уровни, сохраняем, меняем, загружаем.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
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

async function snap(ms = 3500) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

/** Аудио-параметры (не метры). */
const AUDIO = [
  [0x21, 0x04, 'Mic1 vol'],
  [0x22, 0x04, 'Mic2 vol'],
  [0x23, 0x04, 'Aux vol'],
  [0x25, 0x04, 'BT vol'],
  [0x27, 0x04, 'OTG vol'],
  [0x64, 0x03, 'HP vol'],
  [0x62, 0x03, 'OTG out vol'],
  [0x44, 0x01, 'FX IN1'],
  [0x44, 0x02, 'FX IN2'],
  [0x44, 0x06, 'NoiseRed'],
  [0x44, 0x08, 'DryWet'],
];

function grab(s) {
  const o = {};
  for (const [tt, pp, name] of AUDIO) o[name] = s.get((tt << 8) | pp);
  return o;
}

console.log('=== 1. исходное ===');
let s = await snap();
const base = grab(s);
console.log(JSON.stringify(base));

console.log('\n=== 2. SAVE PRESET2 (0x11:0x0b) ===');
dev.write([...withReportId(buildFrame(0x11, 0x0b, 1, true))]);
await sleep(2500);

console.log('\n=== 3. меняем громкости ===');
const CH = [
  [0x21, 0x04, 10, 'Mic1 vol -> 10'],
  [0x23, 0x04, 20, 'Aux vol -> 20'],
  [0x44, 0x01, -20, 'FX IN1 -> -20'],
];
for (const [tt, pp, v, name] of CH) {
  dev.write([...withReportId(buildFrame(tt, pp, v, true))]);
  console.log(`  ${name}`);
  await sleep(600);
}
await sleep(2000);
s = await snap();
console.log('  стало:', JSON.stringify(grab(s)));

console.log('\n=== 4. LOAD PRESET2 (0x11:0x12) ===');
dev.write([...withReportId(buildFrame(0x11, 0x12, 1, true))]);
await sleep(4000);
s = await snap();
const after = grab(s);
console.log('  после:', JSON.stringify(after));

console.log('\n=== РЕЗУЛЬТАТ ===');
let ok = 0, total = 0;
for (const [name] of AUDIO.map((a) => [a[2]])) {
  const b = base[name], a = after[name];
  if (b === undefined) continue;
  total++;
  const match = b === a;
  console.log(`  ${name.padEnd(12)} было ${String(b).padStart(5)}, сейчас ${String(a).padStart(5)}  ${match ? 'ВОССТАНОВЛЕНО' : 'изменено'}`);
  if (match) ok++;
}
console.log(`\n  восстановлено: ${ok}/${total}`);

dev.close();
process.exit(0);
