/**
 * ПОЧЕМУ usbCPower ПРОПАЛ?
 *
 * В логе: первое чтение дало usbCPower=1, второе — undefined.
 * Проверяем, приходит ли 0x11:0x1c при ANNOUNCE.
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
const log = [];
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const key = (m.target << 8) | m.prop;
  seen.set(key, m.value);
  if ((m.target === 0x11) && m.prop >= 0x1a && m.prop <= 0x1f) {
    log.push(`  0x11:0x${m.prop.toString(16)} = ${m.value}`);
  }
});

console.log('=== ANNOUNCE #1 ===');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);
console.log(`  получено 0x11:0x1a-0x1f: ${log.length} тегов`);
for (const l of log) console.log(l);

console.log('\n  все настройки:');
for (const [pp, name] of [[0x04, 'brightness'], [0x1a, 'bluetooth'], [0x1b, 'otgPower'], [0x1c, 'usbCPower'], [0x1e, 'autoPower'], [0x22, 'btnSingle'], [0x23, 'btnDouble']]) {
  const v = seen.get((0x11 << 8) | pp);
  console.log(`    0x11:0x${pp.toString(16)} ${name} = ${v === undefined ? 'НЕ ПРИШЁЛ' : v}`);
}

console.log('\n=== ANNOUNCE #2 ===');
log.length = 0;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);
for (const [pp, name] of [[0x04, 'brightness'], [0x1a, 'bluetooth'], [0x1b, 'otgPower'], [0x1c, 'usbCPower'], [0x1e, 'autoPower']]) {
  const v = seen.get((0x11 << 8) | pp);
  console.log(`    0x11:0x${pp.toString(16)} ${name} = ${v === undefined ? 'НЕ ПРИШЁЛ' : v}`);
}

console.log('\n=== ANNOUNCE #3 (после паузы 10 с) ===');
await sleep(10000);
log.length = 0;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(6000);
for (const [pp, name] of [[0x04, 'brightness'], [0x1a, 'bluetooth'], [0x1b, 'otgPower'], [0x1c, 'usbCPower'], [0x1e, 'autoPower']]) {
  const v = seen.get((0x11 << 8) | pp);
  console.log(`    0x11:0x${pp.toString(16)} ${name} = ${v === undefined ? 'НЕ ПРИШЁЛ' : v}`);
}

dev.close();
