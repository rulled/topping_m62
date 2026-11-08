/**
 * ЧТО ДЕЛАЕТ "Load settings" (0x11:0x20)?
 *
 * Гипотеза: загружает настройки из какого-то файла/слота.
 * Если так — это может быть путь записи для компрессора.
 *
 * Тест: меняем файл вручную, шлём 0x11:0x20, смотрим применилось ли.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
dev.on('error', () => { /* перезагрузка возможна */ });

const seen = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen.set((m.target << 8) | m.prop, m.value);
});

const state = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  return {
    ws: `${w.mode}/${w.name}`,
    bright: seen.get(0x1104),
    hpGain: i.Output_HP?.GAIN,
    mixA: i.Mixer_IN12?.MixA_GAIN,
    ratio: i.Compressor?.Ratio,
  };
};

console.log('=== ДО ===');
console.log(' ', JSON.stringify(state()));

// 1) Меняем файл вручную при закрытом MCC
console.log('\n1. закрываю MCC и меняю файл (MixA=6, HP=-25)');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(4000);

const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.Mixer_IN12.MixA_GAIN = '6';
ini.Output_HP.GAIN = '-25';
writeWorkspace(w.path, ini);
console.log('   файл изменён');

// 2) Шлём Load settings
console.log('\n2. отправляю 0x11:0x20 (Load settings) = 1');
dev.write([...withReportId(buildFrame(0x11, 0x20, 1, true))]);
await sleep(4000);

console.log('\n3. файл после:', JSON.stringify(state()));

// 3) Запускаем MCC и смотрим, применилось ли
console.log('\n4. запускаю MCC...');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(14000);

const after = state();
console.log('\n5. после запуска MCC:', JSON.stringify(after));

console.log('\n=== ВЫВОД ===');
console.log(`  MixA: был 6 (в файле), стал ${after.mixA}`);
console.log(`  HP:   был -25 (в файле), стал ${after.hpGain}`);
if (after.mixA === 6 || after.hpGain === -25) {
  console.log('  Load settings ПРИМЕНИЛ файл -> устройство');
} else {
  console.log('  Load settings НЕ применил изменения файла');
}

dev.close();
process.exit(0);
