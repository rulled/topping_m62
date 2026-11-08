/**
 * Дамп ВСЕХ приходящих тегов (target:prop) без фильтрации.
 *
 * Цель: убедиться, что бекенд не теряет теги, которые видит
 * mainline-драйвер (например, мьюты выходов).
 *
 * Читаем через readTimeout(5) в пачке — так же, как транспорт.
 *
 * Запуск: node src/tools/dump-raw-tags.js [мс]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const DURATION_MS = Number(process.argv[2] ?? 9000);

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

console.log(`открываю: iface=${dev.interface}`);
const h = new HID.HID(dev.path);

/** TT:PP -> { value, count, firstAt } */
const seen = new Map();
const t0 = Date.now();
let reports = 0;
let idle = 0;
let bad = 0;

const send = (tt, pp, v) => {
  try {
    h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  } catch { /* ok */ }
};

send(0x11, 0x24, 1);

const keepalive = setInterval(() => send(0x11, 0x24, 1), 2000);
keepalive.unref?.();

setTimeout(() => send(0x11, 0x26, 1), 200);

const drain = () => {
  if (Date.now() - t0 >= DURATION_MS) return finish();
  for (let i = 0; i < 64; i++) {
    let buf;
    try {
      buf = h.readTimeout(5);
    } catch (err) {
      console.error('read:', err.message);
      return finish();
    }
    if (!buf || !buf.length) break;
    reports += 1;
    // readTimeout() отдаёт обычный массив (не Buffer).
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    // report ID может присутствовать или нет — пробуем оба смещения.
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) {
      f = bytes.subarray(1);
    }
    if (f.length < 15) { bad += 1; continue; }
    if (f[0] !== 0x22 || f[1] !== 0x33) { idle += 1; continue; }
    if (f[13] !== 0x66 || f[14] !== 0x77) { bad += 1; continue; }
    const tt = f[5];
    const pp = f[6];
    const value = f.readInt32BE(7);
    const key = `${tt.toString(16).padStart(2, '0')}:${pp.toString(16).padStart(2, '0')}`;
    const cur = seen.get(key);
    if (!cur) seen.set(key, { value, count: 1, firstAt: Date.now() - t0 });
    else { cur.value = value; cur.count += 1; }
  }
  setTimeout(drain, 0);
};

const finish = () => {
  clearInterval(keepalive);
  console.log(`\nотчётов=${reports} пустых=${idle} битых=${bad}`);
  console.log(`=== тегов: ${seen.size} ===`);
  const rows = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [k, v] of rows) {
    console.log(`  ${k}  value=${String(v.value).padStart(9)}  x${String(v.count).padStart(3)}  t=${v.firstAt}ms`);
  }
  try { h.close(); } catch { /* ok */ }
  process.exit(0);
};

setTimeout(drain, 0);
