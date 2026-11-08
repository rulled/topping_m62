/**
 * Диагностика: сколько раз и когда приходят теги настроек.
 *
 * Помогает понять, почему часть значений не доходит.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const WATCH = {
  0x1104: 'Brightness', 0x111a: 'Bluetooth', 0x111b: 'OtgPower',
  0x111c: 'UsbCPower', 0x111d: 'Mode', 0x111e: 'AutoPower',
  0x1118: 'counter', 0x1119: '0x19', 0x1122: 'BtnSingle', 0x1123: 'BtnDouble',
  0x4501: 'SceneChat', 0x4502: 'SceneVocal',
};

const counts = new Map();
const vals = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  if (!(k in WATCH)) return;
  counts.set(k, (counts.get(k) ?? 0) + 1);
  vals.set(k, m.value);
});

console.log('шлю ANNOUNCE 5 раз с интервалом 1.2 с\n');
for (let i = 0; i < 5; i++) {
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(1200);
}
await sleep(1000);

console.log('тег      имя           получен  значение');
for (const [k, name] of Object.entries(WATCH)) {
  const key = Number(k);
  const c = counts.get(key) ?? 0;
  const v = vals.get(key);
  const status = c === 0 ? 'НЕТ' : `${c}×`;
  console.log(`0x${key.toString(16).padStart(4, '0')}  ${name.padEnd(13)} ${status.padEnd(8)} ${v === undefined ? '-' : v}`);
}

dev.close();
process.exit(0);
