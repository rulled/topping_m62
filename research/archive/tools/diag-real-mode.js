/**
 * ДИАГНОСТИКА: в каком режиме устройство на самом деле?
 *
 * Семейства тегов в HID указывают на режим:
 *   - Live/Prof: много семейств (0x44, 0x46, 0x91...)
 *   - Mobile: только базовые (11, 12, 21-25, 62, 64)
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { listWorkspaces, findActiveWorkspace, findActiveWorkspaceFromRegistry } from '../workspace.js';

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

console.log('отправляю ANNOUNCE...');
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(4500);

const families = [...new Set([...seen.keys()].map((k) => (k >> 8)))].sort((a, b) => a - b);
console.log(`\nпараметров: ${seen.size}`);
console.log('семейства:', families.map((f) => '0x' + f.toString(16)).join(', '));

const hasEffects = families.includes(0x44);
const hasCompressor = families.includes(0x46);
const hasEqIn = families.includes(0x91);
const hasDuck = families.includes(0x43);

console.log('\n=== ПРИЗНАКИ ===');
console.log(`  0x44 (эффекты):     ${hasEffects ? 'ЕСТЬ' : 'нет'}`);
console.log(`  0x46 (компрессор):  ${hasCompressor ? 'ЕСТЬ' : 'нет'}`);
console.log(`  0x91 (EQ входов):   ${hasEqIn ? 'ЕСТЬ' : 'нет'}`);
console.log(`  0x43 (ducking):     ${hasDuck ? 'ЕСТЬ' : 'нет'}`);

console.log('\n=== ВЫВОД ===');
if (!hasEffects && !hasCompressor && !hasEqIn) {
  console.log('  Похоже на MOBILE режим (только базовые теги)');
} else if (hasEffects && hasEqIn && !hasCompressor) {
  console.log('  Похоже на LIVE (эффекты + EQ, без компрессора в HID)');
} else if (!hasEffects && hasCompressor) {
  console.log('  Похоже на PRO (компрессор есть, эффектов нет)');
} else {
  console.log('  Неопределённо');
}

console.log('\n=== WORKSPACE ===');
const all = listWorkspaces();
console.log('  по mtime (свежий):');
for (const w of all.slice(0, 3)) console.log(`    ${w.mode}/${w.name} (${w.mtime.toISOString()})`);
console.log(`  findActiveWorkspace(): ${findActiveWorkspace()?.mode}/${findActiveWorkspace()?.name}`);
for (const m of ['Live', 'Prof', 'Mble']) {
  const r = findActiveWorkspaceFromRegistry(m);
  console.log(`  реестр ${m}: ${r?.name ?? '—'}`);
}

dev.close();
