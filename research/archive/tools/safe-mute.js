/**
 * АВАРИЙНАЯ ЗАЩИТА: заглушить выходы через HID напрямую.
 *
 * 0x64:0x06 = HP mute
 * 0x62:0x06 = OTG mute
 *
 * Делаем ДО любых работ с EQ/усилением.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
if (!found.length) { console.log('устройство не найдено'); process.exit(1); }
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', () => {});

const seen = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen.set((m.target << 8) | m.prop, m.value);
});

console.log('=== ДО ===');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(4000);
console.log(`  HP mute    (0x64:0x06) = ${seen.get(0x6406)}`);
console.log(`  OTG mute   (0x62:0x06) = ${seen.get(0x6206)}`);

console.log('\n=== СТАВЛЮ MUTE ===');
dev.write([...withReportId(buildFrame(0x64, 0x06, 1, true))]);
await sleep(600);
dev.write([...withReportId(buildFrame(0x62, 0x06, 1, true))]);
await sleep(1500);
console.log('  отправлено HP=1, OTG=1');

console.log('\n=== ПРОВЕРКА ===');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(4000);
const hp = seen.get(0x6406);
const otg = seen.get(0x6206);
console.log(`  HP mute  = ${hp}  ${hp === 1 ? '✓ ЗАГЛУШЕН' : '⚠ ПРОВЕРИТЬ'}`);
console.log(`  OTG mute = ${otg}  ${otg === 1 ? '✓ ЗАГЛУШЕН' : '⚠ ПРОВЕРИТЬ'}`);

dev.close();
process.exit(hp === 1 ? 0 : 1);
