/**
 * ПРОВЕРКА: можно ли менять РЕЖИМ через HID (0x11:0x1d)?
 *
 * Ранее режим менялся только через UI MCC (Mode select combo).
 * Проверяем прямой HID-путь — это упростило бы бекенд.
 *
 * ВНИМАНИЕ: смена режима ПЕРЕЗАГРУЖАЕТ устройство (1-8 с).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { listWorkspaces, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }

console.log('=== ДО ===');
const ws0 = findActiveWorkspace();
console.log(`  workspace: ${ws0.mode}/${ws0.name}`);

let dev = new HID.HID(vp.path);
dev.on('error', () => { /* перезагрузка */ });

console.log('\n*** отправляю 0x11:0x1d = 3 (Pro audio) ***');
dev.write([...withReportId(buildFrame(0x11, 0x1d, 3, true))]);

console.log('  жду перезагрузку...');
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  const f = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
  if (f.length === 0) process.stdout.write('.');
  else if (i > 2) break;
}
await sleep(5000);

console.log('\n=== ПОСЛЕ ===');
const all = listWorkspaces();
console.log('  свежие workspace:');
for (const w of all.slice(0, 3)) console.log(`    ${w.mode}/${w.name}  (${w.mtime.toISOString()})`);

const ws1 = findActiveWorkspace();
console.log(`\n  активный: ${ws1.mode}/${ws1.name}`);
const changed = ws0.mode !== ws1.mode || ws0.name !== ws1.name;
console.log(`  режим изменился через HID: ${changed ? 'ДА' : 'нет'}`);

if (changed) {
  console.log('\n  HID-путь смены режима РАБОТАЕТ');
} else {
  console.log('\n  HID-путь НЕ работает — режим меняется только через UI MCC');
}

try { dev.close(); } catch { /* уже */ }
process.exit(0);
