/**
 * КАЛИБРОВКА ШКАЛЫ МЕТРОВ.
 *
 * Метод: меняем усиление входа IN1 на известную величину (через HID),
 * смотрим сдвиг метра. Отношение "единиц метра / дБ" даёт масштаб.
 *
 * Безопасность: HP замьючен перед прогоном (см. research/mute-hp.ps1).
 * IN1 — микрофонный вход; меняем только его GAIN, записывая обратно.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TAG_MIC1_VOL = 0x2104;  // громкость mic-1
const TAG_IN1_METER = 0x2101;

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

const dev = new HID.HID(vp.path);
let meterSamples = [];
let currentMeter = null;

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const tag = (m.target << 8) | m.prop;
  if (tag === TAG_IN1_METER) {
    currentMeter = m.value;
    meterSamples.push(m.value);
  }
});

function send(target, prop, value) {
  dev.write([...withReportId(buildFrame(target, prop, value, true))]);
}

/** Средняя мощность метра за interval мс (в сырых единицах). */
async function measure(interval = 4000) {
  meterSamples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < interval) {
    await sleep(2000 - ((Date.now() - t0) % 2000));
    send(0x11, 0x26, 1);
  }
  if (!meterSamples.length) return null;
  // среднее арифметическое (в логарифмическом домене это среднее по dB)
  const avg = meterSamples.reduce((a, b) => a + b, 0) / meterSamples.length;
  return { avg, min: Math.min(...meterSamples), max: Math.max(...meterSamples), n: meterSamples.length };
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3000);

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
const gainBefore = Number(ini.Input_IN1?.GAIN ?? 0);
console.log(`\nтекущий Input_IN1.GAIN = ${gainBefore}`);

console.log('\n=== ЗАМЕР 1: базовый ===');
const m0 = await measure(6000);
console.log('  метр IN1:', JSON.stringify(m0));

// Меняем громкость mic1 через HID на +10 (если возможно)
console.log('\n=== МЕНЯЮ громкость mic1 через HID ===');
const volBefore = ini.Input_IN1?.VOLUME ?? null;
console.log('  VOLUME в файле:', volBefore);

// Читаем текущую громкость из HID (придёт в потоке)
let volCurrent = null;
// подписка уже идёт, но громкость придёт только по ANNOUNCE — уже прошёл.
// Поэтому просто шлём команду и смотрим реакцию метра.

for (const delta of [10, -10]) {
  console.log(`\n=== шлём volume ${delta > 0 ? '+' : ''}${delta} к mic1 (0x2104) ===`);
  // пробуем установить громкость 70 (типичная середина)
  send(0x21, 0x04, 70);
  await sleep(2500);
  const m = await measure(6000);
  console.log('  метр IN1:', JSON.stringify(m));
  if (m0 && m) {
    const shift = (m.avg - m0.avg).toFixed(1);
    console.log(`  сдвиг: ${shift} сырых единиц`);
  }
}

dev.close();
console.log('\nготово');
