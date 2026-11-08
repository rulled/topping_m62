/**
 * Смена режима через HID — проверка всех трёх режимов.
 * 1=Mobile, 2=Live, 3=Pro (по таблице из MCC).
 */
import HID from 'node-hid';
import { buildFrame, withReportId } from '../protocol.js';
import { findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VID = 0x152a, PID = 0x875c;

function openDev() {
  const f = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = f.find((d) => d.interface === 4);
  if (!vp) return null;
  try { return new HID.HID(vp.path); } catch { return null; }
}

async function setMode(value, label) {
  console.log(`\n--- ${label}: 0x11:0x1d = ${value} ---`);
  const before = findActiveWorkspace();

  const dev = openDev();
  if (!dev) { console.log('  устройство не открылось'); return null; }
  dev.on('error', () => { /* перезагрузка */ });
  try {
    dev.write([...withReportId(buildFrame(0x11, 0x1d, value, true))]);
  } catch (e) {
    console.log('  ошибка записи:', e.message);
  }

  // ждём перезагрузку
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const f = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
    if (f.length > 0 && i > 3) break;
  }
  await sleep(4000);

  const after = findActiveWorkspace();
  const changed = before && after && (before.mode !== after.mode || before.name !== after.name);
  console.log(`  было: ${before?.mode}/${before?.name}`);
  console.log(`  стало: ${after?.mode}/${after?.name}`);
  console.log(`  ${changed ? 'СМЕНИЛОСЬ' : 'не изменилось'}`);
  return after?.mode;
}

console.log('текущий режим:', findActiveWorkspace()?.mode);

// Pro -> Live
await setMode(2, 'Live streaming');
// Live -> Mobile
await setMode(1, 'Mobile');
// Mobile -> Live (возврат)
await setMode(2, 'Live streaming (возврат)');

console.log('\n=== ИТОГ ===');
console.log('текущий режим:', findActiveWorkspace()?.mode);
process.exit(0);
