/**
 * РЕШАЮЩИЙ ТЕСТ ШКАЛЫ МЕТРОВ.
 *
 * Проблема прошлых замеров: среднее сглаживает пики, а метр пиковый.
 * Здесь снимаем одновременно:
 *   - raw: mean И max за окно
 *   - подпись MCC (labelInputLevel1), которая показывает уровень в UI
 *
 * Если подпись показывает число — она и есть эталонная шкала.
 *
 * Безопасность: HP замьючен.
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
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

const PS_LABEL = 'research\\read-fx-levels.ps1';

function readLabels() {
  try {
    return execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_LABEL],
      { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

async function measure(ms) {
  vals = [];
  const t0 = Date.now();
  const labels = [];
  while (Date.now() - t0 < ms) {
    await sleep(700);
    send(0x11, 0x26, 1);
    if (Date.now() - t0 > ms * 0.55 && labels.length < 3) labels.push(readLabels());
  }
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    mean: Math.round(mean),
    max: Math.max(...vals),
    p90: Math.round(vals.slice().sort((a, b) => a - b)[Math.floor(vals.length * 0.9)] ?? 0),
    n: vals.length,
    labels: labels.filter(Boolean),
  };
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
const orig = ctl.volumes.find((v) => v.id === 'mic1').current;

console.log('проверка подписей:');
console.log('  ', readLabels());

for (const gain of [20, 40, 60, 80, 88]) {
  await setMic1(gain);
  const m = await measure(4500);
  console.log(`\ngain=${String(gain).padStart(3)}  mean=${String(m.mean).padStart(6)}  max=${String(m.max).padStart(6)}  p90=${String(m.p90).padStart(6)}  n=${m.n}`);
  if (m.labels.length) console.log(`   подписи MCC: ${m.labels.join(' | ')}`);
  console.log(`   если /10: ${(m.max / 10).toFixed(1)} dB   если /100: ${(m.max / 100).toFixed(2)} dB`);
}

await setMic1(orig);
console.log(`\nmic1 возвращён на ${orig}`);
dev.close();
