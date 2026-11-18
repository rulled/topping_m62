/**
 * ГЛАВНЫЙ ВОПРОС: заставляет ли "Load settings" MCC перечитать файл БЕЗ перезапуска?
 *
 * Если да — это устранит 17-секундный цикл из WRITE-METHOD!
 * Проверяем: MCC работает, меняем файл, шлём 0x11:0x20, смотрим на UI.
 */
import HID from 'node-hid';
import { buildFrame, withReportId } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';
import { ps as uiaPs, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

// проверяем, что MCC запущен
const cnt = Number(ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'));
if (cnt === 0) {
  console.log('MCC не запущен — запускаю...');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(15000);
}

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
dev.on('error', () => {});

const mixA = () => {
  const i = readWorkspace(findActiveWorkspace().path);
  return i.Mixer_IN12?.MixA_GAIN;
};

console.log('\n=== 1. исходное ===');
console.log(`  файл MixA = ${mixA()}`);

console.log('\n=== 2. меняю файл ВРУЧНУЮ при работающем MCC ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
const NEW = mixA() === '3' ? '5' : '3';
ini.Mixer_IN12.MixA_GAIN = NEW;
writeWorkspace(w.path, ini);
console.log(`  записал MixA = ${NEW}`);
console.log(`  в файле сейчас: ${mixA()}`);

console.log('\n=== 3. жду 3 с — перезапишет ли MCC? ===');
await sleep(3000);
console.log(`  файл: ${mixA()}  ${mixA() === NEW ? 'MCC НЕ тронул' : 'MCC ПЕРЕЗАПИСАЛ'}`);

console.log('\n=== 4. шлю Load settings (0x11:0x20) ===');
dev.write([...withReportId(buildFrame(0x11, 0x20, 1, true))]);
await sleep(3000);
console.log(`  файл после: ${mixA()}`);

console.log('\n=== 5. смотрю на UI MCC — какое значение на слайдере? ===');
const { items } = dumpTree();
// ищем слайдер микшера IN12 -> Mix A (первый слайдер в верхней области)
const mixerSliders = items.filter((x) => x.cls === 'QSlider' && x.ly > 450 && x.ly < 620 && x.lx > 1100);
console.log(`  найдено слайдеров микшера: ${mixerSliders.length}`);
if (mixerSliders.length) {
  // Mix A — первый по x
  const sorted = mixerSliders.sort((a, b) => a.lx - b.lx);
  const mixA_slider = sorted[0];
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${mixA_slider.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ("value=" + $rv.Current.Value + " min=" + $rv.Current.Minimum + " max=" + $rv.Current.Maximum)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const val = uiaPs(RAW).trim();
  console.log(`  слайдер Mix A: ${val}`);
  console.log(`  (в файле ${mixA()}, записали ${NEW})`);
} else {
  console.log('  слайдеры микшера не найдены — возможно, другая страница MCC');
}

dev.close();
process.exit(0);
