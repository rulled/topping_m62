/**
 * СБРОС К ЗАВОДСКИМ НАСТРОЙКАМ — проверка команды 0x11:0x21.
 *
 * ДЕСТРУКТИВНО. Перед запуском нужен бэкап (уже сделан).
 *
 * Снимаем состояние ДО, отправляем Reset, снимаем ПОСЛЕ, показываем дифф.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

async function snap(ms = 3500) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

function nonMeter(s) {
  const out = {};
  for (const [k, v] of s) {
    const tt = k >> 8;
    if (v < -100 && [0x21, 0x25, 0x26, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36,
      0x39, 0x44, 0x46, 0x61, 0x62, 0x63, 0x64, 0x9b].includes(tt)) continue;
    out[`0x${k.toString(16).padStart(4, '0')}`] = v;
  }
  return out;
}

function fileState() {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    ws: `${ws.mode}/${ws.name}`,
    in1gain: i.Input_IN1?.GAIN,
    in1_48v: i.Input_IN1?.['48V'],
    mixA: i.Mixer_IN12?.MixA_GAIN,
    eqSwitch: i.EQ_IN1?.Switch,
    eqBand1: i.EQ_IN1?.['Eq%401'],
    duckSwitch: i.Ducking?.DuckingSwitch,
    reverbType: i.Effect_Integration?.ReverbType,
    compSwitch: i.Compressor?.Switch,
    compThr: i.Compressor?.Threshold,
    lb12gain: i.Loopback_LB12?.GAIN,
    hpGain: i.Output_HP?.GAIN,
  };
}

console.log('=== ДО СБРОСА ===');
const before_hid = nonMeter(await snap());
const before_file = fileState();
console.log('HID:', JSON.stringify(before_hid, null, 0).slice(0, 300));
console.log('\nфайл:', JSON.stringify(before_file, null, 1));

console.log('\n\n*** ОТПРАВЛЯЮ RESET TO FACTORY (0x11:0x21 = 1) ***');
dev.write([...withReportId(buildFrame(0x11, 0x21, 1, true))]);
console.log('   кадр отправлен, жду 8 секунд...');
await sleep(8000);

// устройство может перезагрузиться — проверяем
let s2 = null;
try {
  s2 = await snap(4000);
} catch (e) {
  console.log('   устройство не отвечает, ждём ещё...');
  await sleep(8000);
  s2 = await snap(4000);
}

const after_hid = nonMeter(s2);
const after_file = fileState();

console.log('\n=== ПОСЛЕ СБРОСА ===');
console.log('файл:', JSON.stringify(after_file, null, 1));

console.log('\n=== ИЗМЕНЕНИЯ В ФАЙЛЕ ===');
const keys = new Set([...Object.keys(before_file), ...Object.keys(after_file)]);
let changed = 0;
for (const k of keys) {
  if (String(before_file[k]) !== String(after_file[k])) {
    console.log(`  ${k}: ${before_file[k]} -> ${after_file[k]}`);
    changed++;
  }
}
if (!changed) console.log('  файл не изменился');

console.log('\n=== ИЗМЕНЕНИЯ В HID ===');
let hc = 0;
for (const k of new Set([...Object.keys(before_hid), ...Object.keys(after_hid)])) {
  if (before_hid[k] !== after_hid[k]) {
    console.log(`  ${k}: ${before_hid[k]} -> ${after_hid[k]}`);
    hc++;
  }
}
if (!hc) console.log('  HID не изменился');

dev.close();
process.exit(0);
