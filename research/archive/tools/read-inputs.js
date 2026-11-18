/**
 * Читаем ВСЕ теги семейства 0x21 (IN1) и 0x22 (IN2) — там MIC/48V/MUTE.
 *
 * По таблице имён MCC (mcc_tag_names.txt):
 *   0x2101=MUTE  0x2102=48V  0x2103=INST  0x2105=GAIN  0x2109=ANTI
 *   0x2201=MUTE  0x2202=48V  0x2203=INST  0x2205=GAIN  0x2209=ANTI
 *
 * Проверяем, приходят ли они.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
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

const NAMES = {
  0x2101: 'IN1 MUTE', 0x2102: 'IN1 48V', 0x2103: 'IN1 INST',
  0x2104: 'IN1 GAIN', 0x2105: 'IN1 0x05', 0x2106: 'IN1 present', 0x2109: 'IN1 ANTI', 0x210a: 'IN1 0x0a',
  0x2201: 'IN2 MUTE', 0x2202: 'IN2 48V', 0x2203: 'IN2 INST',
  0x2204: 'IN2 GAIN', 0x2205: 'IN2 0x05', 0x2206: 'IN2 present', 0x2209: 'IN2 ANTI', 0x220a: 'IN2 0x0a',
};

console.log('=== TT=0x21 (IN1) и 0x22 (IN2) ===\n');
for (const [k, nm] of Object.entries(NAMES)) {
  const key = Number(k);
  const v = s.get(key);
  console.log(`  0x${key.toString(16).padStart(4, '0')}  ${nm.padEnd(14)} = ${v === undefined ? '(нет)' : v}`);
}

console.log('\nвсе TT=0x21:');
for (const k of [...s.keys()].filter((x) => x >> 8 === 0x21).sort((a, b) => a - b)) {
  console.log(`  0x${k.toString(16)} = ${s.get(k)}`);
}
console.log('\nвсе TT=0x22:');
for (const k of [...s.keys()].filter((x) => x >> 8 === 0x22).sort((a, b) => a - b)) {
  console.log(`  0x${k.toString(16)} = ${s.get(k)}`);
}
process.exit(0);
