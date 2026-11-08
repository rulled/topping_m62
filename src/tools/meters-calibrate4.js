/**
 * A/B-КАЛИБРОВКА МЕТРОВ (устраняет дрейф шума).
 *
 * Проблема прошлых замеров: шум комнаты меняется во времени, поэтому
 * последовательные замеры несравнимы.
 *
 * Метод: быстро чередуем громкость mic1 между LO и HI, каждый раз коротко
 * меряя метр IN1. Разница HI−LO считается для каждой пары отдельно,
 * затем усредняется. Дрейф шума так сокращается.
 *
 * Если гипотеза «raw/10 = dB» верна, то сдвиг метра в сырых единицах
 * должен быть ≈ 10 × (число дБ между LO и HI).
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
    await sleep(700);
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
  await sleep(900);
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3500);

const ctl = await (await fetch('http://127.0.0.1:8787/api/controls')).json();
const mic1 = ctl.volumes.find((v) => v.id === 'mic1');
const orig = mic1.current;
console.log(`mic1 текущий = ${orig} (${mic1.db} dB)`);

// TLV_GAIN: шаг 1 дБ, значит разница значений = разница дБ
const LO = Math.max(1, orig - 25);
const HI = Math.min(88, orig + 25);
const DB = HI - LO;
console.log(`LO=${LO}  HI=${HI}  разница = ${DB} дБ\n`);

const PAIRS = 4;
const rows = [];
for (let i = 0; i < PAIRS; i++) {
  await setMic1(LO);
  const lo = await measure(3200);
  await setMic1(HI);
  const hi = await measure(3200);
  const diff = (hi !== null && lo !== null) ? hi - lo : null;
  rows.push({ lo, hi, diff });
  console.log(`  пара ${i + 1}: LO=${lo}  HI=${hi}  diff=${diff}   (${diff !== null ? (diff / DB).toFixed(2) : '?'} ед/дБ)`);
}

await setMic1(orig);
console.log(`\nmic1 возвращён на ${orig}`);

dev.close();

const valid = rows.filter((r) => r.diff !== null).map((r) => r.diff);
if (valid.length) {
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const perDb = avg / DB;
  console.log('\n=== РЕЗУЛЬТАТ ===');
  console.log(`средний сдвиг: ${avg.toFixed(1)} сырых единиц за ${DB} дБ`);
  console.log(`коэффициент:   ${perDb.toFixed(2)} сырых единиц на дБ`);
  console.log('');
  console.log('проверка гипотез:');
  for (const [name, k] of [['/10', 10], ['/100', 100], ['/256', 256], ['1:1', 1]]) {
    const expect = k;
    const err = Math.abs(perDb - expect) / expect * 100;
    const mark = err < 25 ? '  <<< ПОДХОДИТ' : '';
    console.log(`  ${name.padEnd(6)} ожидалось ${String(expect).padStart(4)} ед/дБ, ошибка ${err.toFixed(1)}%${mark}`);
  }
}
