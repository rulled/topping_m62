/**
 * Наблюдение за конкретными тегами БЕЗ подписки.
 *
 * Зачем: подписку держит MCC, а нам надо увидеть, что меняется,
 * когда человек щёлкает в UI. Ничего не отправляем в устройство.
 *
 * Запуск: node src/tools/watch-tags.js [мс] [фильтр-hex]
 */

import HID from 'node-hid';

const VID = 0x152a;
const PID = 0x875c;
const DURATION_MS = Number(process.argv[2] ?? 15000);

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const t0 = Date.now();
const last = new Map();
let reports = 0;

console.log('наблюдаю (без подписки), filter=0x64/0x62/0x61/0x63');

const drain = () => {
  if (Date.now() - t0 >= DURATION_MS) {
    console.log('--- конец наблюдения ---');
    try { h.close(); } catch { /* ok */ }
    process.exit(0);
  }
  for (let i = 0; i < 64; i++) {
    let buf;
    try {
      buf = h.readTimeout(5);
    } catch (err) {
      console.error('read:', err.message);
      try { h.close(); } catch { /* ok */ }
      process.exit(1);
    }
    if (!buf || !buf.length) break;
    reports += 1;
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) {
      f = bytes.subarray(1);
    }
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    const tt = f[5];
    const pp = f[6];
    if (![0x61, 0x62, 0x63, 0x64].includes(tt)) continue;
    const value = f.readInt32BE(7);
    const key = `${tt.toString(16)}:${pp.toString(16)}`;
    if (last.get(key) === value) continue;
    const prev = last.has(key) ? last.get(key) : '—';
    last.set(key, value);
    console.log(`  t=${String(Date.now() - t0).padStart(6)}ms  ${key}  ${prev} -> ${value}`);
  }
  setTimeout(drain, 0);
};

setTimeout(drain, 0);
