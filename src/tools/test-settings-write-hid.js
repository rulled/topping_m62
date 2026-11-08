/**
 * ПРОВЕРКА ЗАПИСИ НАСТРОЕК ЧЕРЕЗ HID.
 *
 * Читал их раньше, но не писал. Проверяем каждую:
 * brightness, bluetooth, otgPower, usbCPower, autoPower, mainButton*.
 *
 * Это те же кадры, что шлёт MCC (0x11:PP).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ENUMS, TOGGLES } from '../settings.js';

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

const read = (s, target, prop) => s.get((target << 8) | prop);

console.log('=== ЧИТАЕМ ИСХОДНОЕ ===');
let s = await snap();
const snapshot = {};
for (const e of [...TOGGLES, ...ENUMS]) {
  snapshot[e.id] = read(s, e.target, e.prop);
  console.log(`  ${e.id.padEnd(18)} = ${snapshot[e.id] ?? '—'}`);
}

// выбираем новые значения (отличающиеся)
function nextValue(def) {
  if (def.options) {
    const cur = snapshot[def.id];
    const opts = def.options.map((o) => o.value);
    const idx = opts.indexOf(cur);
    return opts[(idx + 1) % opts.length];
  }
  // toggle
  return snapshot[def.id] === 1 ? 0 : 1;
}

console.log('\n=== ПИШЕМ НОВЫЕ ЗНАЧЕНИЯ ===');
const planned = [];
for (const e of [...TOGGLES, ...ENUMS]) {
  if (e.writeOnly) continue; // mode пропускаем — перезагружает устройство
  const v = nextValue(e);
  if (v === undefined || v === snapshot[e.id]) continue;
  console.log(`  ${e.id.padEnd(18)}: ${snapshot[e.id]} -> ${v}`);
  dev.write([...withReportId(buildFrame(e.target, e.prop, v, true))]);
  planned.push({ id: e.id, target: e.target, prop: e.prop, want: v, was: snapshot[e.id] });
  await sleep(400);
}

await sleep(2000);
console.log('\n=== ПРОВЕРКА ===');
s = await snap();
let ok = 0;
for (const p of planned) {
  const now = read(s, p.target, p.prop);
  const pass = now === p.want;
  console.log(`  ${p.id.padEnd(18)} ${p.was} -> ${now}  (ожидали ${p.want})  ${pass ? 'OK' : 'FAIL'}`);
  if (pass) ok++;
}
console.log(`\n  итого: ${ok}/${planned.length}`);

// возвращаем исходные значения
console.log('\n=== ВОЗВРАТ ===');
for (const p of planned) {
  if (p.was === undefined || p.was === null) continue;
  dev.write([...withReportId(buildFrame(p.target, p.prop, p.was, true))]);
  await sleep(300);
}
await sleep(1500);
s = await snap();
let back = 0;
for (const p of planned) {
  const now = read(s, p.target, p.prop);
  if (now === p.was) back++;
}
console.log(`  восстановлено: ${back}/${planned.length}`);

dev.close();
process.exit(0);
