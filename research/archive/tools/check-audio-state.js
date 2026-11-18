/**
 * Проверка текущего аудио-состояния после тестов пресетов.
 * Не сломали ли мы что-то.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

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

const s = new Map(seen);
cap = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3500);
cap = null;
dev.close();

const P = [
  [0x21, 0x04, 'Mic1 vol', 0, 88],
  [0x22, 0x04, 'Mic2 vol', 0, 88],
  [0x23, 0x04, 'Aux vol', 0, 99],
  [0x25, 0x04, 'BT vol', 0, 99],
  [0x27, 0x04, 'OTG vol', 0, 99],
  [0x64, 0x03, 'HP vol', 0, 99],
  [0x62, 0x03, 'OTG out vol', 0, 99],
  [0x44, 0x01, 'FX IN1', -90, 12],
  [0x44, 0x02, 'FX IN2', -90, 12],
  [0x44, 0x03, 'FX AUX', -90, 12],
  [0x44, 0x04, 'FX BT', -90, 12],
  [0x44, 0x05, 'FX OTG', -90, 12],
  [0x44, 0x06, 'NoiseRed', 0, 100],
  [0x44, 0x08, 'DryWet', 0, 100],
];

console.log('=== ТЕКУЩЕЕ АУДИО-СОСТОЯНИЕ (HID) ===\n');
console.log('параметр        значение   диапазон   в норме?');
let bad = 0;
for (const [tt, pp, name, min, max] of P) {
  const v = s.get((tt << 8) | pp);
  if (v === undefined) { console.log(`  ${name.padEnd(14)} —          ${min}..${max}   (нет данных)`); continue; }
  const ok = v >= min && v <= max;
  if (!ok) bad++;
  console.log(`  ${name.padEnd(14)} ${String(v).padStart(6)}     ${String(min).padStart(4)}..${String(max).padStart(4)}   ${ok ? 'да' : 'НЕТ'}`);
}

console.log('\n=== ФАЙЛ (workspace) ===');
const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`  workspace: ${ws.mode}/${ws.name}`);
console.log(`  Input_IN1.GAIN = ${ini.Input_IN1?.GAIN}`);
console.log(`  Effect.Input1Level = ${ini.Effect_Integration?.Input1Level}`);
console.log(`  Effect.AuxLevel = ${ini.Effect_Integration?.AuxLevel}`);
console.log(`  Effect.NoiseReductionNC1 = ${ini.Effect_Integration?.NoiseReductionNC1}`);

console.log(`\nвне диапазона: ${bad}`);
process.exit(0);
