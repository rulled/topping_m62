/**
 * СНЯТИЕ НАСТРОЕК С УСТРОЙСТВА.
 *
 * Читает все известные теги настроек через ANNOUNCE и печатает их значения.
 * Ничего не пишет в устройство.
 *
 * Использование:
 *   node src/tools/read-settings.js
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

/** Известные теги настроек M62 (из реверса MCC, функция 0x230400). */
export const SETTINGS = [
  { tag: 0x1104, id: 'brightness',   name: 'Brightness',        enum: { 0: 'Dim', 1: 'Normal', 2: 'Bright' } },
  { tag: 0x111a, id: 'bluetooth',    name: 'Bluetooth' },
  { tag: 0x111b, id: 'otgDirection', name: 'OtgDirection' },
  { tag: 0x111c, id: 'usbCCharging', name: 'UsbCCharging',      enum: { 1: 'Charge', 2: 'Discharge', 3: 'Disabled' } },
  { tag: 0x111d, id: 'mode',         name: 'FirmwareSelected',  enum: { 1: 'Mobile', 2: 'Live streaming', 3: 'Pro audio' } },
  { tag: 0x111e, id: 'autoPoweroff', name: 'AutoPoweroff' },
  { tag: 0x1121, id: 'restoreDefault', name: 'RestoreDefault' },
  { tag: 0x1122, id: 'mainButtonSingle', name: 'MainButtonSingle' },
  { tag: 0x1123, id: 'mainButtonDouble', name: 'MainButtonDouble' },
  { tag: 0x111f, id: 'updateFirmware', name: 'UpdateFirmware' },
  { tag: 0x1120, id: 'loadSettings', name: 'LoadSettings' },
  { tag: 0x1118, id: 'counter',      name: '0x11:0x18 (счётчик)' },
  { tag: 0x4501, id: 'sceneChat',    name: 'Scene: Chat' },
  { tag: 0x4502, id: 'sceneVocal',   name: 'Scene: Vocal' },
];

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const latest = new Map();
let capture = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});

async function snap(ms = 3000) {
  const s = new Map(latest);
  capture = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  capture = null;
  return s;
}

const snap1 = await snap();
console.log(`получено параметров: ${snap1.size}\n`);

console.log('=== НАСТРОЙКИ УСТРОЙСТВА ===');
console.log();
for (const s of SETTINGS) {
  const v = snap1.get(s.tag);
  const tagHex = '0x' + s.tag.toString(16).padStart(4, '0');
  if (v === undefined) {
    console.log(`  ${tagHex}  ${s.name.padEnd(24)} = (не пришло)`);
    continue;
  }
  let decoded = '';
  if (s.enum && s.enum[v] !== undefined) decoded = '  -> ' + s.enum[v];
  console.log(`  ${tagHex}  ${s.name.padEnd(24)} = ${String(v).padStart(5)}${decoded}`);
}

console.log('\n=== ВСЕ ПОЛУЧЕННЫЕ ТЕГИ (для сверки) ===');
const keys = [...snap1.keys()].sort((a, b) => a - b);
for (const k of keys) {
  const tt = (k >> 8) & 0xff, pp = k & 0xff;
  console.log(`  0x${tt.toString(16).padStart(2, '0')}:0x${pp.toString(16).padStart(2, '0')} = ${snap1.get(k)}`);
}

dev.close();
process.exit(0);
