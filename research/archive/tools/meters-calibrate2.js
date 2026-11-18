/**
 * КАЛИБРОВКА ШКАЛЫ МЕТРОВ — через известный сдвиг громкости.
 *
 * Идея: меняем громкость mic1 (HID 0x2104) на N шагов и смотрим, на сколько
 * сырых единиц сдвинулся метр IN1 (0x2101). Отношение даёт units/дБ,
 * если известно, сколько дБ в шаге громкости.
 *
 * Проверяем ТРИ гипотезы масштаба: /10, /100, /256 (Q8.8).
 *
 * Безопасность: HP замьючен (research/mute-hp.ps1), звук не выходит.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

const dev = new HID.HID(vp.path);
let samples = [];

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const tag = (m.target << 8) | m.prop;
  if (tag === 0x2101) samples.push(m.value);
});

const send = (t, p, v) => dev.write([...withReportId(buildFrame(t, p, v, true))]);

async function measure(ms) {
  samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(1000);
    send(0x11, 0x26, 1);
  }
  if (!samples.length) return null;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { avg: Math.round(avg), min: Math.min(...samples), max: Math.max(...samples), n: samples.length };
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3500);

// Узнаём текущую громкость mic1 из ANNOUNCE-потока не получится (нужен свежий),
// поэтому читаем из API сервера.
async function apiVolumes() {
  const r = await fetch('http://127.0.0.1:8787/api/controls');
  const j = await r.json();
  return j.volumes;
}

const vols = await apiVolumes();
const mic1 = vols?.find((v) => v.id === 'mic1' || /mic.?1/i.test(v.name ?? ''));
console.log('\nmic1:', JSON.stringify(mic1));

async function setVolume(id, value) {
  await fetch('http://127.0.0.1:8787/api/volume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, value }),
  });
  await sleep(1200);
}

const start = mic1?.value ?? 44;
console.log(`\nстартовая громкость: ${start}`);

const m0 = await measure(6000);
console.log('метр при', start, ':', JSON.stringify(m0));

// Понижаем на 20 шагов — метр должен упасть
const low = Math.max(0, start - 20);
await setVolume('mic1', low);
const m1 = await measure(6000);
console.log(`метр при ${low}:`, JSON.stringify(m1));

// Повышаем на 40 шагов от низкого
const high = Math.min(mic1?.max ?? 88, start + 20);
await setVolume('mic1', high);
const m2 = await measure(6000);
console.log(`метр при ${high}:`, JSON.stringify(m2));

// вернуть
await setVolume('mic1', start);
const m3 = await measure(5000);
console.log(`метр при ${start} (возврат):`, JSON.stringify(m3));

dev.close();

console.log('\n=== РАСЧЁТ ===');
const dSteps = high - low;
const dRaw = (m2 && m1) ? m2.avg - m1.avg : null;
console.log(`шагов громкости: ${dSteps}   сдвиг метра: ${dRaw} сырых единиц`);
if (dRaw !== null && dSteps !== 0) {
  const perStep = dRaw / dSteps;
  console.log(`  = ${perStep.toFixed(2)} сырых единиц на шаг громкости`);
  console.log('\n  если 1 шаг = 1 дБ:');
  console.log(`    шкала /10   -> ${(perStep / 10).toFixed(2)} дБ на шаг`);
  console.log(`    шкала /100  -> ${(perStep / 100).toFixed(3)} дБ на шаг`);
  console.log(`    шкала /256  -> ${(perStep / 256).toFixed(3)} дБ на шаг`);
}
