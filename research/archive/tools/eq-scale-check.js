/**
 * ПРОВЕРКА ШКАЛ EQ В HID.
 *
 * Замечено: файл Q=0.7, HID 0x9105 = 7070. Гипотеза: Q × 10000.
 * Также: 0x9104 = 632 (частота), 0x9103 = 0 (тип?), 0x9106 = 0 (gain?).
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
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

// ставим понятные значения в файл
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.EQ_IN1['Eq%401'] = '|0|1000|1|6';   // тип 0, freq 1000, Q 1, gain 6
ini.EQ_IN1['Eq%402'] = '|0|250|0.5|-3';  // тип 0, freq 250, Q 0.5, gain -3
const { writeWorkspace } = await import('../workspace.js');
writeWorkspace(w.path, ini);
console.log('записал в файл:');
console.log('  Eq%401 = |0|1000|1|6');
console.log('  Eq%402 = |0|250|0.5|-3');

// перезапускаем MCC чтобы применилось
const { execFileSync } = await import('node:child_process');
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue'], { encoding: 'utf8' });
await sleep(4000);
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'], { encoding: 'utf8' });
await sleep(16000);
dev.close();

// открываем заново и читаем
const f2 = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp2 = f2.find((d) => d.interface === 4);
const dev2 = new HID.HID(vp2.path);
dev2.on('error', () => {});

const seen2 = new Map();
dev2.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen2.set((m.target << 8) | m.prop, m.value);
});

console.log('\nLoad preset1 (чтобы EQ-теги пришли)...');
dev2.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(6000);

console.log('\n=== HID ПОСЛЕ УСТАНОВКИ ЗНАЧЕНИЙ ===');
console.log('полоса 1 (0x91:01..06):');
for (const pp of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06]) {
  console.log(`  0x91:0x0${pp} = ${seen2.get((0x91 << 8) | pp)}`);
}
console.log('полоса 2 (0x91:07..0a):');
for (const pp of [0x07, 0x08, 0x09, 0x0a]) {
  console.log(`  0x91:0x0${pp} = ${seen2.get((0x91 << 8) | pp)}`);
}

console.log('\n=== ФАЙЛ ===');
const cur = readWorkspace(findActiveWorkspace().path);
console.log('  Eq%401 =', cur.EQ_IN1?.['Eq%401']);
console.log('  Eq%402 =', cur.EQ_IN1?.['Eq%402']);

console.log('\n=== ГИПОТЕЗА ===');
const q1 = seen2.get((0x91 << 8) | 0x05);
const f1 = seen2.get((0x91 << 8) | 0x04);
const g1 = seen2.get((0x91 << 8) | 0x06);
console.log(`  Q=1    -> HID ${q1}   (Q×10000 = 10000)`);
console.log(`  freq=1000 -> HID ${f1}`);
console.log(`  gain=6 -> HID ${g1}`);

dev2.close();
