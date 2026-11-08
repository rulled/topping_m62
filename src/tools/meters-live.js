/**
 * СНЯТЬ ЖИВЫЕ ЗНАЧЕНИЯ МЕТРОВ.
 *
 * Гипотеза: значения метров приходят как сырые int16 со знаком в сотых долях dB
 * (например -596 = -5.96 dB). Проверяем диапазон и правдоподобие.
 *
 * Также снимаем текст с QLabel'ов MCC (labelInputLevel1 и т.п.), чтобы сверить.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

const dev = new HID.HID(vp.path);
const latest = new Map(); // tag -> {value, count, min, max}
const raw = new Map();    // tag -> последние 40 значений

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const tag = (m.target << 8) | m.prop;
  const rec = latest.get(tag) ?? { value: m.value, count: 0, min: m.value, max: m.value };
  rec.value = m.value;
  rec.count++;
  if (m.value < rec.min) rec.min = m.value;
  if (m.value > rec.max) rec.max = m.value;
  latest.set(tag, rec);
  const arr = raw.get(tag) ?? [];
  arr.push(m.value);
  if (arr.length > 40) arr.shift();
  raw.set(tag, arr);
});

// подписка + keepalive
console.log('подписка...');
dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
for (let i = 0; i < 15; i++) {
  await sleep(2000);
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
}

dev.close();

// Какие теги активно менялись? Это и есть метры.
const KNOWN_METERS = new Set([
  0x2101, 0x2501, 0x2601, 0x3115, 0x3215, 0x3315, 0x3415, 0x3515, 0x3615,
  0x3901, 0x3902, 0x440d, 0x440e, 0x4609, 0x460a, 0x460c, 0x460d,
  0x6101, 0x6201, 0x6301, 0x6401, 0x9b0b,
]);

console.log('\n=== ВСЕ ТЕГИ С ДИАПАЗОНОМ ===');
console.log('tag'.padEnd(10), 'count'.padStart(6), 'min'.padStart(9), 'max'.padStart(9), '  метка');
const rows = [...latest.entries()].sort((a, b) => a[0] - b[0]);
for (const [tag, r] of rows) {
  const hex = '0x' + tag.toString(16).padStart(4, '0');
  const mark = KNOWN_METERS.has(tag) ? 'METER' : '';
  console.log(hex.padEnd(10), String(r.count).padStart(6), String(r.min).padStart(9), String(r.max).padStart(9), ' ', mark);
}

// Масштаб: проверяем гипотезу «сотые доли dB»
console.log('\n=== ГИПОТЕЗА: /100 = dB ===');
for (const tag of KNOWN_METERS) {
  const r = latest.get(tag);
  if (!r) continue;
  const hex = '0x' + tag.toString(16).padStart(4, '0');
  const samples = (raw.get(tag) ?? []).slice(-8);
  console.log(`${hex}  raw ${String(r.min).padStart(6)}..${String(r.max).padStart(6)}  ->  ${(r.min / 100).toFixed(2)}..${(r.max / 100).toFixed(2)} dB   посл: ${samples.join(',')}`);
}
