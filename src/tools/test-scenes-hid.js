/**
 * Проверка сцен через HID напрямую (надёжный путь).
 * Не зависит от состояния UI MCC.
 */
import HID from 'node-hid';
import { buildFrame, withReportId } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const duck = () => {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path).Ducking?.DuckingSwitch;
};

console.log('исходное DuckingSwitch =', duck());

console.log('\n--- Vocal (0x45:0x02) ---');
dev.write([...withReportId(buildFrame(0x45, 0x02, 1, true))]);
await sleep(1800);
const afterVocal = duck();
console.log('  стало:', afterVocal, afterVocal === '0' ? 'OK' : 'FAIL');

console.log('\n--- Chat (0x45:0x01) ---');
dev.write([...withReportId(buildFrame(0x45, 0x01, 1, true))]);
await sleep(1800);
const afterChat = duck();
console.log('  стало:', afterChat, afterChat === '1' ? 'OK' : 'FAIL');

console.log('\n--- Vocal снова ---');
dev.write([...withReportId(buildFrame(0x45, 0x02, 1, true))]);
await sleep(1800);
const afterVocal2 = duck();
console.log('  стало:', afterVocal2, afterVocal2 === '0' ? 'OK' : 'FAIL');

const allOk = afterVocal === '0' && afterChat === '1' && afterVocal2 === '0';
console.log(`\nИТОГ: ${allOk ? 'сцены работают стабильно' : 'ЕСТЬ ПРОБЛЕМА'}`);

dev.close();
process.exit(allOk ? 0 : 1);
