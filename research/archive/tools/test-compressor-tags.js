/**
 * ГИПОТЕЗА: теги компрессора 0x46:0x01..0x08 приходят после LOAD PRESET.
 *
 * В §32 выяснилось: Load preset возвращает аудио-состояние
 * (FX IN1/IN2, NoiseRed, DryWet восстановились).
 * Значит компрессор тоже должен приходить.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

// Собираем ВСЁ, что приходит, включая 0x46
const all = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  all.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log('=== ФАЙЛ (эталон) ===');
console.log(`  Compressor: switch=${ini.Compressor?.Switch} thr=${ini.Compressor?.Threshold} ratio=${ini.Compressor?.Ratio} att=${ini.Compressor?.Attack} rel=${ini.Compressor?.Release} gain=${ini.Compressor?.Gain} mix=${ini.Compressor?.Mix}`);
console.log(`  NoiseRed: ${ini.Effect_Integration?.NoiseReductionNC1}`);

/** Захватить всё за N мс. */
async function capture(ms, label) {
  const snap = new Map();
  cap = snap;
  await sleep(ms);
  cap = null;
  const t46 = [...snap.keys()].filter((k) => (k >> 8) === 0x46).sort((a, b) => a - b);
  console.log(`\n${label}: всего ${snap.size}, из 0x46 — ${t46.length}`);
  for (const k of t46) {
    console.log(`  0x${k.toString(16).padStart(4, '0')} = ${snap.get(k)}`);
  }
  return snap;
}

// 1) обычный ANNOUNCE
all.clear();
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await capture(3000, '1. ANNOUNCE');

// 2) LOAD PRESET1
all.clear();
console.log('\n*** LOAD PRESET1 ***');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await capture(5000, '2. после LOAD PRESET1');

// 3) LOAD PRESET2
all.clear();
console.log('\n*** LOAD PRESET2 ***');
dev.write([...withReportId(buildFrame(0x11, 0x12, 1, true))]);
await capture(5000, '3. после LOAD PRESET2');

// 4) клик по вкладке эффектов? Попробуем ANNOUNCE + смена типа реверба
all.clear();
console.log('\n*** переключаю реверб + ANNOUNCE ***');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await capture(3000, '4. ANNOUNCE + реверб');

console.log('\n=== ВЫВОД ===');
const hasComp = [...all.keys()].some((k) => (k >> 8) === 0x46 && (k & 0xff) <= 0x08);
console.log(`теги компрессора 0x46:0x01..0x08 получены: ${hasComp ? 'ДА' : 'НЕТ'}`);

dev.close();
process.exit(0);
