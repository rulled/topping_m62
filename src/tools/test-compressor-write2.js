/**
 * ПРОВЕРКА ЗАПИСИ КОМПРЕССОРА через HID после LOAD PRESET.
 *
 * Гипотеза: устройство принимает запись 0x46:PP, если перед этим
 * было загружено состояние (Load preset) — тогда теги «живые».
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

const comp = () => {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    thr: i.Compressor?.Threshold,
    ratio: i.Compressor?.Ratio,
    att: i.Compressor?.Attack,
    rel: i.Compressor?.Release,
    mix: i.Compressor?.Mix,
  };
};

console.log('=== 1. LOAD PRESET1 (чтобы теги ожили) ===');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(5000);

// проверим, что теги пришли
cap = seen;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(2500);
cap = null;
console.log(`  0x46 тегов в кэше: ${[...seen.keys()].filter((k) => (k >> 8) === 0x46).length}`);
console.log(`  0x4602 (Threshold) = ${seen.get(0x4602)}`);
console.log(`  файл: ${JSON.stringify(comp())}`);

console.log('\n=== 2. ПИШУ Threshold = -12 через HID ===');
dev.write([...withReportId(buildFrame(0x46, 0x02, -12, true))]);
await sleep(2000);

console.log(`  HID 0x4602 = ${seen.get(0x4602)}`);
console.log(`  файл Threshold = ${comp().thr}`);

console.log('\n=== 3. ПИШУ Ratio = 8 через HID ===');
dev.write([...withReportId(buildFrame(0x46, 0x03, 8, true))]);
await sleep(2000);
console.log(`  HID 0x4603 = ${seen.get(0x4603)}`);
console.log(`  файл Ratio = ${comp().ratio}`);

const thrOk = seen.get(0x4602) === -12;
const ratioOk = seen.get(0x4603) === 8;
console.log(`\n=== РЕЗУЛЬТАТ ===`);
console.log(`  Threshold записан: ${thrOk ? 'ДА' : 'нет'}`);
console.log(`  Ratio записан: ${ratioOk ? 'ДА' : 'нет'}`);

if (thrOk || ratioOk) {
  console.log('\n  *** КОМПРЕССОР ПИШЕТСЯ ЧЕРЕЗ HID после Load preset! ***');
} else {
  console.log('\n  компрессор всё ещё не пишется через HID');
}

dev.close();
process.exit(0);
