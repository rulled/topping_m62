/**
 * СВЕРКА: совпадают ли значения в workspace-файле и в HID?
 *
 * Если Input_IN1.GAIN (43) == HID 0x21:0x04, значит это один параметр,
 * и каналы дублируют друг друга.
 * Если различаются — это РАЗНЫЕ параметры (например, аналоговое усиление
 * против цифрового).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, parseAll } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = findActiveWorkspace();
const parsed = parseAll(readWorkspace(ws.path));

console.log(`workspace: ${ws.mode}/${ws.name}\n`);

// HID
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

const s = new Map(seen);
cap = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3500);
cap = null;
dev.close();

const hid = (tt, pp) => s.get((tt << 8) | pp);

console.log('=== ВХОДЫ: файл против HID ===\n');
console.log('параметр         файл    HID      совпадает?');
const rows = [
  ['IN1 GAIN', 43, hid(0x21, 0x04)],
  ['IN2 GAIN', 26, hid(0x22, 0x04)],
  ['AUX GAIN', 0, hid(0x23, 0x04)],
  ['BT GAIN', -6, hid(0x25, 0x04)],
  ['OTG GAIN', 0, hid(0x27, 0x04)],
];
for (const [name, fileVal, hidVal] of rows) {
  const match = fileVal === hidVal ? 'ДА' : 'нет';
  console.log(`${name.padEnd(16)} ${String(fileVal).padStart(5)} ${String(hidVal ?? '—').padStart(7)}   ${match}`);
}

console.log('\n=== ЭФФЕКТЫ (Input1Level и т.д.) против HID 0x44 ===\n');
const fx = parsed.effects.inputLevels;
console.log('параметр         файл    HID      совпадает?');
const fxRows = [
  ['FX IN1 level', fx.input1, hid(0x44, 0x01)],
  ['FX IN2 level', fx.input2, hid(0x44, 0x02)],
  ['FX AUX level', fx.aux, hid(0x44, 0x03)],
  ['FX BT level', fx.bluetooth, hid(0x44, 0x04)],
  ['FX OTG level', fx.otg, hid(0x44, 0x05)],
];
for (const [name, fileVal, hidVal] of fxRows) {
  const match = fileVal === hidVal ? 'ДА' : 'нет';
  console.log(`${name.padEnd(16)} ${String(fileVal).padStart(5)} ${String(hidVal ?? '—').padStart(7)}   ${match}`);
}

console.log('\n=== КОМПРЕССОР против HID 0x46 ===\n');
const c = parsed.compressor;
const cRows = [
  ['Threshold', c.threshold, hid(0x46, 0x02)],
  ['Ratio', c.ratio, hid(0x46, 0x03)],
  ['Attack', c.attack, hid(0x46, 0x04)],
  ['Release', c.release, hid(0x46, 0x05)],
  ['Gain', c.gain, hid(0x46, 0x06)],
  ['Mix', c.mix, hid(0x46, 0x08)],
];
for (const [name, fileVal, hidVal] of cRows) {
  const match = fileVal === hidVal ? 'ДА' : 'нет';
  console.log(`${name.padEnd(16)} ${String(fileVal).padStart(5)} ${String(hidVal ?? '—').padStart(7)}   ${match}`);
}

console.log('\n=== DUCKING против HID 0x43 ===\n');
const d = parsed.ducking;
const dRows = [
  ['Threshold', d.threshold, hid(0x43, 0x01)],
  ['Attack', d.attack, hid(0x43, 0x02)],
  ['Reduction', d.reduction, hid(0x43, 0x03)],
  ['Release', d.release, hid(0x43, 0x04)],
  ['Switch', d.switch, hid(0x43, 0x07)],
];
for (const [name, fileVal, hidVal] of dRows) {
  const match = fileVal === hidVal ? 'ДА' : 'нет';
  console.log(`${name.padEnd(16)} ${String(fileVal).padStart(5)} ${String(hidVal ?? '—').padStart(7)}   ${match}`);
}

console.log('\nвсего HID-параметров:', s.size);
