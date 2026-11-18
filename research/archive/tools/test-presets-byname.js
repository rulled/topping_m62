/**
 * ПРОВЕРКА ПРЕСЕТОВ ПО ИМЕНИ с изменением состояния.
 *
 * Сохраняем preset1, ломаем состояние, загружаем preset1.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickByName(name) {
  const { items } = dumpTree();
  const el = items.find((x) => (x.name || '').trim() === name);
  if (!el) return `"${name}" не найден`;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${el.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

const st = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  return {
    duck: i.Ducking?.DuckingSwitch,
    thr: i.Compressor?.Threshold,
    ratio: i.Compressor?.Ratio,
    mixA: i.Mixer_IN12?.MixA_GAIN,
    hp: i.Output_HP?.GAIN,
    eq1: i.EQ_IN1?.['Eq%401'],
  };
};

console.log('=== 1. исходное ===');
const before = st();
console.log(' ', JSON.stringify(before));

console.log('\n=== 2. Save preset1 ===');
console.log('  ' + clickByName('Save preset1'));
await sleep(3000);

console.log('\n=== 3. ЛОМАЮ состояние через файл ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.Ducking.DuckingSwitch = before.duck === '1' ? '0' : '1';
ini.Compressor.Threshold = '-40';
ini.Compressor.Ratio = '10';
ini.Mixer_IN12.MixA_GAIN = '1';
ini.Output_HP.GAIN = '-50';
ini.EQ_IN1['Eq%401'] = '|0|1000|1|12';
const wsMod = await import('../workspace.js');
wsMod.writeWorkspace(w.path, ini);
console.log('  изменил 6 параметров в файле');

// перезапускаем MCC, чтобы применилось
console.log('\n=== 4. перезапускаю MCC (чтобы поломка применилась) ===');
const { execFileSync } = await import('node:child_process');
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue'], { encoding: 'utf8' });
await sleep(4000);
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'], { encoding: 'utf8' });
await sleep(15000);

const broken = st();
console.log('  после поломки:', JSON.stringify(broken));

console.log('\n=== 5. Load preset1 по имени ===');
console.log('  ' + clickByName('Load preset1'));
await sleep(5000);
const restored = st();
console.log('  после загрузки:', JSON.stringify(restored));

console.log('\n=== 6. ЧТО ВОССТАНОВИЛОСЬ ===');
const KEYS = ['duck', 'thr', 'ratio', 'mixA', 'hp', 'eq1'];
let ok = 0;
for (const k of KEYS) {
  const match = String(before[k]) === String(restored[k]);
  console.log(`  ${k.padEnd(6)} было ${String(before[k]).padStart(8)}, стало ${String(restored[k]).padStart(8)}  ${match ? 'ВОССТАНОВЛЕНО' : 'изменено'}`);
  if (match) ok++;
}
console.log(`\n  совпало с исходным: ${ok}/${KEYS.length}`);

// вернуть исходное через файл
const restore = readWorkspace(findActiveWorkspace().path);
restore.Ducking.DuckingSwitch = before.duck;
restore.Compressor.Threshold = before.thr;
restore.Compressor.Ratio = before.ratio;
restore.Mixer_IN12.MixA_GAIN = before.mixA;
restore.Output_HP.GAIN = before.hp;
restore.EQ_IN1['Eq%401'] = before.eq1;
wsMod.writeWorkspace(findActiveWorkspace().path, restore);
console.log('\n(восстановил исходные значения в файле)');
