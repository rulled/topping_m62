/**
 * ЧИСТЫЙ ТЕСТ HID-ПРЕСЕТОВ.
 *
 * 0x11:0x08 = Save preset1
 * 0x11:0x0e = Load preset1
 * 0x11:0x0b = Save preset2
 * 0x11:0x12 = Load preset2
 *
 * Проверяем, ЧТО ИМЕННО хранит устройство в пресете.
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

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

/** Все параметры, кроме метров. */
function nonMeter(s) {
  const out = {};
  for (const [k, v] of s) {
    const tt = k >> 8;
    // метры: значения < -100 и в известных семействах
    if (v < -100 && [0x21, 0x25, 0x26, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36,
      0x39, 0x44, 0x46, 0x61, 0x62, 0x63, 0x64, 0x9b].includes(tt)) continue;
    out[`0x${k.toString(16).padStart(4, '0')}`] = v;
  }
  return out;
}

console.log('=== ШАГ 1: читаем исходное ===');
let s0 = await snap();
let base = nonMeter(s0);
console.log(`  параметров (без метров): ${Object.keys(base).length}`);
console.log('  ключевые:', JSON.stringify({
  bright: base['0x1104'], bt: base['0x111a'], usbC: base['0x111c'],
  btnS: base['0x1122'], btnD: base['0x1123'],
}));

console.log('\n=== ШАГ 2: SAVE PRESET1 (0x11:0x08 = 1) ===');
dev.write([...withReportId(buildFrame(0x11, 0x08, 1, true))]);
await sleep(2500);

console.log('\n=== ШАГ 3: меняем настройки ===');
const CHANGES = [
  { tt: 0x11, pp: 0x04, v: 0, name: 'brightness -> 0 (Dim)' },
  { tt: 0x11, pp: 0x1a, v: 1, name: 'bluetooth -> 1' },
  { tt: 0x11, pp: 0x1c, v: 1, name: 'usbC -> 1 (Charge)' },
  { tt: 0x11, pp: 0x22, v: 5, name: 'btnSingle -> 5' },
];
for (const c of CHANGES) {
  dev.write([...withReportId(buildFrame(c.tt, c.pp, c.v, true))]);
  console.log(`  ${c.name}`);
  await sleep(500);
}
await sleep(2000);

let s1 = await snap();
let after = nonMeter(s1);
console.log('  после изменений:', JSON.stringify({
  bright: after['0x1104'], bt: after['0x111a'], usbC: after['0x111c'],
  btnS: after['0x1122'],
}));

console.log('\n=== ШАГ 4: LOAD PRESET1 (0x11:0x0e = 1) ===');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(3500);

let s2 = await snap();
let restored = nonMeter(s2);
console.log('  после загрузки:', JSON.stringify({
  bright: restored['0x1104'], bt: restored['0x111a'], usbC: restored['0x111c'],
  btnS: restored['0x1122'],
}));

console.log('\n=== РЕЗУЛЬТАТ: что пресет восстановил ===');
const KEYS = ['0x1104', '0x111a', '0x111b', '0x111c', '0x111e', '0x1122', '0x1123'];
let ok = 0;
for (const k of KEYS) {
  const was = base[k], now = restored[k];
  if (was === undefined) continue;
  const match = was === now;
  console.log(`  ${k}  было ${was}, сейчас ${now}  ${match ? 'ВОССТАНОВЛЕНО' : 'изменено'}`);
  if (match) ok++;
}
console.log(`\n  совпало с исходным: ${ok}/${KEYS.filter((k) => base[k] !== undefined).length}`);

dev.close();
process.exit(0);
