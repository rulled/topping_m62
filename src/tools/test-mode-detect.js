/**
 * Проверка detectModeFromHid и checkModeConsistency на живом устройстве.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { detectModeFromHid, checkModeConsistency } from '../modes.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { parseAll } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
if (!found.length) { console.log('устройства нет'); process.exit(1); }
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

console.log('ANNOUNCE...');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(4500);

console.log(`\nполучено тегов: ${seen.size}`);

console.log('\n=== detectModeFromHid ===');
const fromHid = detectModeFromHid(seen);
console.log('  mode:', fromHid.mode, `(${fromHid.confidence})`);
console.log('  families:', fromHid.families.map((f) => '0x' + f.toString(16)).join(','));
for (const r of fromHid.reasons) console.log('  -', r);

console.log('\n=== detectMode по workspace ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
const parsed = parseAll(ini);
const wsObj = { mode: w.mode, ...parsed };

const { detectMode } = await import('../modes.js');
const fromWs = detectMode(wsObj);
console.log('  mode:', fromWs.mode, `(${fromWs.confidence})`);
for (const r of fromWs.reasons) console.log('  -', r);

console.log('\n=== checkModeConsistency ===');
const cons = checkModeConsistency(wsObj, seen);
console.log('  consistent:', cons.consistent);
if (cons.warning) console.log('  ⚠', cons.warning);
else console.log('  ✓ режимы совпадают');

dev.close();
