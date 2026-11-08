/**
 * ПРОВЕРКА ЛИНЕЙНОСТИ ШКАЛЫ МЕТРА.
 *
 * Если шкала линейна в dB, то сдвиг raw пропорционален разнице усиления
 * на ЛЮБОМ интервале. Проверяем 15, 30, 60 дБ.
 *
 * Если наклон постоянный -> шкала линейна, можно реализовывать raw/k.
 * Если наклон падает на больших интервалах -> шкала сжата (лог-лог).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('нет устройства'); process.exit(1); }

const dev = new HID.HID(vp.path);
let vals = [];

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  if (((m.target << 8) | m.prop) === 0x2101) vals.push(m.value);
});

const send = (t, p, v) => dev.write([...withReportId(buildFrame(t, p, v, true))]);

async function measure(ms) {
  vals = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await sleep(600); send(0x11, 0x26, 1); }
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  return { mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), p50: s[Math.floor(s.length * 0.5)], p90: s[Math.floor(s.length * 0.9)] };
}

async function setMic1(v) {
  await fetch('http://127.0.0.1:8787/api/volume', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'mic1', value: v }),
  });
  await sleep(850);
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3000);

const ctl = await (await fetch('http://127.0.0.1:8787/api/controls')).json();
const orig = ctl.volumes.find((v) => v.id === 'mic1').current;

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('\nразница  наклон(raw/дБ)  [3 пары]');
const results = [];
for (const sep of [15, 30, 60]) {
  const lo = Math.max(1, 44 - Math.floor(sep / 2));
  const hi = Math.min(88, lo + sep);
  const realSep = hi - lo;
  const slopes = [];
  for (let i = 0; i < 3; i++) {
    await setMic1(lo);
    const a = await measure(2500);
    await setMic1(hi);
    const b = await measure(2500);
    if (a && b) slopes.push((b.p50 - a.p50) / realSep);
  }
  const m = med(slopes);
  results.push({ sep: realSep, slope: m });
  console.log(`  ${String(realSep).padStart(2)} дБ    ${m.toFixed(3)}          (${slopes.map((x) => x.toFixed(2)).join(', ')})`);
}

await setMic1(orig);
console.log(`\nmic1 -> ${orig}`);
dev.close();

console.log('\n=== ЛИНЕЙНОСТЬ ===');
const slopes = results.map((r) => r.slope);
const avg = slopes.reduce((a, b) => a + b, 0) / slopes.length;
const spread = (Math.max(...slopes) - Math.min(...slopes)) / avg * 100;
console.log(`средний наклон: ${avg.toFixed(3)} raw/дБ`);
console.log(`разброс по интервалам: ${spread.toFixed(1)}%`);
console.log(spread < 20
  ? '=> шкала ЛИНЕЙНА в dB, можно использовать raw / ' + avg.toFixed(2)
  : '=> шкала НЕ линейна, нужна таблица');
