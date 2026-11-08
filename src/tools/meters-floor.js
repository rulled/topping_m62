/**
 * ПОЛ ШКАЛЫ И ТОЧНЫЙ НАКЛОН В РАБОЧЕЙ ОБЛАСТИ.
 *
 * Наблюдение: при слабом сигнале метр застревает на -902 и не опускается.
 * Значит -902 (или около) — ПОЛ шкалы, а большие интервалы дают заниженный
 * наклон, потому что нижняя точка обрезана полом.
 *
 * Здесь:
 *  1. Находим пол: уводим усиление в минимум и смотрим минимум метра.
 *  2. Меряем наклон на МАЛЫХ интервалах в ВЕРХНЕЙ области (сигнал выше пола).
 *  3. Проверяем гипотезу raw/10 = dB и floor = -90 dB.
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
  while (Date.now() - t0 < ms) { await sleep(550); send(0x11, 0x26, 1); }
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  return {
    min: s[0], p50: s[Math.floor(s.length * 0.5)], p90: s[Math.floor(s.length * 0.9)],
    max: s[s.length - 1], n: vals.length,
  };
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

// ── 1. ПОЛ ──
console.log('\n=== 1. ПОИСК ПОЛА (усиление в минимум) ===');
await setMic1(0);
const floorM = await measure(4000);
console.log(`  gain=0 (mute): min=${floorM?.min} p50=${floorM?.p50} max=${floorM?.max}`);
await setMic1(1);
const f1 = await measure(3000);
console.log(`  gain=1:        min=${f1?.min} p50=${f1?.p50} max=${f1?.max}`);
await setMic1(5);
const f5 = await measure(3000);
console.log(`  gain=5:        min=${f5?.min} p50=${f5?.p50} max=${f5?.max}`);

console.log('\n  ГИПОТЕЗА ПОЛА: raw/10 -> dB');
if (floorM) console.log(`    floor ${floorM.min} -> ${(floorM.min / 10).toFixed(1)} dB`);
if (f1) console.log(`    gain=1 min ${f1.min} -> ${(f1.min / 10).toFixed(1)} dB`);

// ── 2. НАКЛОН В ВЕРХНЕЙ ОБЛАСТИ ──
console.log('\n=== 2. НАКЛОН НА МАЛЫХ ИНТЕРВАЛАХ ВВЕРХУ ===');
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

for (const [lo, hi] of [[70, 78], [76, 84], [80, 88], [60, 68]]) {
  const slopes = [];
  for (let i = 0; i < 3; i++) {
    await setMic1(lo);
    const a = await measure(2400);
    await setMic1(hi);
    const b = await measure(2400);
    if (a && b) slopes.push((b.p50 - a.p50) / (hi - lo));
  }
  const m = med(slopes);
  console.log(`  ${lo}->${hi} (${hi - lo} дБ): наклон ${m.toFixed(2)} raw/дБ   [${slopes.map((x) => x.toFixed(2)).join(', ')}]`);
}

await setMic1(orig);
console.log(`\nmic1 -> ${orig}`);
dev.close();

console.log('\n=== ВЫВОД ===');
console.log('если наклон ≈10 в рабочей области -> шкала raw/10 = dB, пол -90 dB');
