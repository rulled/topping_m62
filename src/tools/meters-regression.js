/**
 * РЕГРЕССИЯ ШКАЛЫ МЕТРА.
 *
 * Снимаем raw-значение метра IN1 при многих значениях громкости mic1
 * (каждый шаг = 1 дБ, кривая TLV_GAIN линейна).
 * Строим линейную регрессию raw = a*dB + b.
 * Наклон a и есть «сырых единиц на дБ» — прямо и точно.
 *
 * Дополнительно: для каждой пары соседних точек считаем локальный наклон,
 * чтобы увидеть, постоянен ли он (нет ли компрессии на краях).
 *
 * Безопасность: HP замьючен.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

const dev = new HID.HID(vp.path);
let acc = 0, n = 0;

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  if (((m.target << 8) | m.prop) === 0x2101) { acc += m.value; n++; }
});

const send = (t, p, v) => dev.write([...withReportId(buildFrame(t, p, v, true))]);

async function measure(ms) {
  acc = 0; n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(600);
    send(0x11, 0x26, 1);
  }
  return n ? Math.round(acc / n) : null;
}

async function setMic1(v) {
  await fetch('http://127.0.0.1:8787/api/volume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'mic1', value: v }),
  });
  await sleep(800);
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3500);

const ctl = await (await fetch('http://127.0.0.1:8787/api/controls')).json();
const mic1 = ctl.volumes.find((v) => v.id === 'mic1');
const orig = mic1.current;

// Точки: от низкого до высокого, шаг 5 дБ
const points = [];
for (let v = 10; v <= 88; v += 6) points.push(v);
if (points[points.length - 1] !== 88) points.push(88);

console.log(`mic1 текущий = ${orig}; снимаю ${points.length} точек\n`);
console.log('  dB    raw');
const data = [];
for (const v of points) {
  await setMic1(v);
  const r = await measure(2600);
  if (r !== null) { data.push({ db: v, raw: r }); console.log(`  ${String(v).padStart(3)}  ${String(r).padStart(6)}`); }
}

await setMic1(orig);
console.log(`\nmic1 возвращён на ${orig}`);
dev.close();

// Линейная регрессия raw = a*db + b
const N = data.length;
const sx = data.reduce((s, d) => s + d.db, 0);
const sy = data.reduce((s, d) => s + d.raw, 0);
const sxy = data.reduce((s, d) => s + d.db * d.raw, 0);
const sxx = data.reduce((s, d) => s + d.db * d.db, 0);
const a = (N * sxy - sx * sy) / (N * sxx - sx * sx);
const b = (sy - a * sx) / N;

console.log('\n=== РЕГРЕССИЯ ===');
console.log(`raw = ${a.toFixed(3)} * dB + ${b.toFixed(1)}`);
console.log(`наклон = ${a.toFixed(3)} сырых единиц на дБ`);
console.log(`то есть 1 дБ = ${a.toFixed(2)} raw;  raw/${a.toFixed(2)} = dB`);

// остатки
let maxErr = 0;
console.log('\n  dB    raw   предсказано  ошибка');
for (const d of data) {
  const pred = a * d.db + b;
  const err = d.raw - pred;
  if (Math.abs(err) > Math.abs(maxErr)) maxErr = err;
  console.log(`  ${String(d.db).padStart(3)}  ${String(d.raw).padStart(6)}  ${pred.toFixed(0).padStart(10)}  ${err.toFixed(0).padStart(7)}`);
}
console.log(`\nмакс. отклонение от прямой: ${maxErr.toFixed(0)} raw`);

console.log('\n=== ПРОВЕРКА ГИПОТЕЗ ===');
for (const [name, k] of [['raw/10', 10], ['raw/8', 8], ['raw/9', 9], ['raw/100', 100], ['raw/256', 256]]) {
  const err = Math.abs(a - k) / k * 100;
  console.log(`  ${name.padEnd(8)} требовалось бы ${String(k).padStart(4)} ед/дБ, ошибка ${err.toFixed(1)}%${err < 10 ? '   <<< близко' : ''}`);
}
