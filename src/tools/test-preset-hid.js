/**
 * ПРЕСЕТЫ через HID: устройство хранит их само?
 *
 * Проверяем: отправить Save preset (0x11:0x08), изменить настройку,
 * отправить Load preset (0x11:0x0e) — вернётся ли состояние.
 *
 * Это ЗАПИСЬ В УСТРОЙСТВО теми же кадрами, что шлёт MCC.
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

async function snap(ms = 2500) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

function fileState() {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    gain: i.Input_IN1?.GAIN,
    mixA: i.Mixer_IN12?.MixA_GAIN,
  };
}

console.log('=== файл ДО ===', JSON.stringify(fileState()));

// 1) читаем HID
let s = await snap();
console.log('HID ДО: параметров', s.size);

// 2) отправляем Save preset1 (0x11:0x08)
console.log('\n1) отправляю SAVE PRESET1 (0x11:0x08 = 1)');
dev.write([...withReportId(buildFrame(0x11, 0x08, 1, true))]);
await sleep(2500);
s = await snap();
console.log('   HID после save: параметров', s.size);
console.log('   файл:', JSON.stringify(fileState()));

// 3) меняем громкость через HID (это разрешено — MCC так делает)
console.log('\n2) меняю Mic1 volume (0x21:0x04) = 30');
const oldGain = s.get(0x2104);
dev.write([...withReportId(buildFrame(0x21, 0x04, 30, true))]);
await sleep(1500);
s = await snap();
console.log(`   0x21:0x04: ${oldGain ?? '—'} -> ${s.get(0x2104) ?? '—'}`);

// 4) отправляем Load preset1
console.log('\n3) отправляю LOAD PRESET1 (0x11:0x0e = 1)');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(3000);
s = await snap();
console.log(`\n   HID после load: 0x21:0x04 = ${s.get(0x2104) ?? '—'}`);
console.log(`   файл: ${JSON.stringify(fileState())}`);

const restored = s.get(0x2104) === oldGain;
console.log(`\n   пресет восстановил громкость: ${restored ? 'ДА' : 'НЕТ'}`);

dev.close();
process.exit(0);
