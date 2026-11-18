/**
 * ВЕРИФИКАЦИЯ ШКАЛЫ Q = ×10000 через HID.
 *
 * Гипотеза (§105): HID 0x9105 = Q_файла × 10000.
 * Проверяем: ставим в файл Q=1.5, ждём применения, читаем HID.
 * Должно быть 15000.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

async function readEqTags() {
  const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
  if (!found.length) return null;
  const vp = found.find((d) => d.interface === 4);
  const dev = new HID.HID(vp.path);
  const seen = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });
  // Load preset чтобы EQ-теги пришли
  dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
  await sleep(6000);
  const out = {};
  for (const pp of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]) {
    out[`0x91:0x0${pp}`] = seen.get((0x91 << 8) | pp);
  }
  try { dev.close(); } catch { /* */ }
  return out;
}

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

console.log('=== ДО ===');
console.log(`  файл Eq%401 = ${band()}`);

console.log('\n=== 1. останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('=== 2. ставлю Q = 1.5 в файл ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
// формат |тип|частота|Q|gain|
ini.EQ_IN1['Eq%401'] = '|0|1000|1.5|0';
writeWorkspace(w.path, ini);
console.log(`  теперь: ${band()}`);

console.log('\n=== 3. запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(18000);

console.log('=== 4. читаю HID ===');
const tags = await readEqTags();
console.log('  EQ-теги:');
for (const [k, v] of Object.entries(tags || {})) {
  console.log(`    ${k} = ${v}`);
}

console.log('\n=== 5. ПРОВЕРКА ГИПОТЕЗЫ ===');
const qTag = tags?.['0x91:0x05'];
console.log(`  Q в файле = 1.5`);
console.log(`  HID 0x91:0x05 = ${qTag}`);
console.log(`  ожидание (×10000) = 15000`);
console.log(`  ${qTag === 15000 ? '✓ ГИПОТЕЗА ПОДТВЕРЖДЕНА' : qTag ? '✗ не совпало' : '? тег не пришёл'}`);

const freqTag = tags?.['0x91:0x04'];
console.log(`\n  freq в файле = 1000`);
console.log(`  HID 0x91:0x04 = ${freqTag}`);
console.log(`  ${freqTag === 1000 ? '✓ частота напрямую' : freqTag ? '✗ не совпало' : '? тег не пришёл'}`);

console.log('\n=== 6. восстанавливаю ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);
const ini2 = readWorkspace(w.path);
ini2.EQ_IN1['Eq%401'] = '|0|632|0.7|0';
writeWorkspace(w.path, ini2);
console.log(`  вернул: ${readWorkspace(w.path).EQ_IN1?.['Eq%401']}`);
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);
console.log('  MCC запущен');
