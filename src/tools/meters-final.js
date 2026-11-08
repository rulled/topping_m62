/**
 * ФИНАЛЬНЫЙ ТЕСТ ЕДИНИЦ МЕТРА.
 *
 * Условия: HP замьючен, микшер в 0. Микрофон — реальный источник шума.
 *
 * Логика: если шкала raw/10, то разница в 40 дБ усиления даст ~400 raw.
 * Если raw/8 — ~320 raw. Если raw/100 — ~40 raw.
 *
 * Усредняем по 6 парам, считаем медиану (устойчива к выбросам).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

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
  while (Date.now() - t0 < ms) {
    await sleep(600);
    send(0x11, 0x26, 1);
  }
  if (!vals.length) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  return {
    mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    n: vals.length,
  };
}

async function setMic1(v) {
  await fetch('http://127.0.0.1:8787/api/volume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'mic1', value: v }),
  });
  await sleep(900);
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3500);

const ctl = await (await fetch('http://127.0.0.1:8787/api/controls')).json();
const orig = ctl.volumes.find((v) => v.id === 'mic1').current;

const LO = 20, HI = 80, DB = HI - LO;
console.log(`LO=${LO}  HI=${HI}  разница=${DB} дБ\n`);

const diffs = { mean: [], p50: [], p90: [] };

for (let i = 0; i < 6; i++) {
  await setMic1(LO);
  const lo = await measure(2800);
  await setMic1(HI);
  const hi = await measure(2800);
  if (!lo || !hi) continue;
  const dm = hi.mean - lo.mean;
  const d5 = hi.p50 - lo.p50;
  const d9 = hi.p90 - lo.p90;
  diffs.mean.push(dm); diffs.p50.push(d5); diffs.p90.push(d9);
  console.log(`  ${i + 1}: mean ${lo.mean}->${hi.mean} (${dm})   p50 ${lo.p50}->${hi.p50} (${d5})   p90 ${lo.p90}->${hi.p90} (${d9})`);
}

await setMic1(orig);
console.log(`\nmic1 -> ${orig}`);
dev.close();

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('\n=== ИТОГ (медиана сдвигов за ' + DB + ' дБ) ===');
for (const [k, arr] of Object.entries(diffs)) {
  if (!arr.length) continue;
  const m = med(arr);
  const perDb = m / DB;
  console.log(`${k.padEnd(5)} сдвиг=${String(m).padStart(5)}  = ${perDb.toFixed(3)} raw/дБ`);
}
console.log('\n=== ВЫБОР ШКАЛЫ ===');
const mMed = med(diffs.mean);
const perDb = mMed / DB;
for (const [name, k] of [['raw/10', 10], ['raw/8', 8], ['raw/9.5', 9.5], ['raw/100', 100]]) {
  const err = Math.abs(perDb - k) / k * 100;
  console.log(`  ${name.padEnd(8)} нужно ${String(k).padStart(5)}  ошибка ${err.toFixed(1)}%${err < 8 ? '   <<< ТОЧНО' : ''}`);
}
