/**
 * РЕШАЮЩИЙ ТЕСТ: применяется ли правка файла при загрузке workspace?
 *
 * Метод:
 *   1) в НЕАКТИВНЫЙ файл (ввв) пишем 48V=1 и GAIN=99
 *   2) переключаемся на ввв
 *   3) смотрим: кнопка 48V в UI стала On? GAIN стал 99?
 *
 * Если да — правка файла РАБОТАЕТ как канал управления.
 */
import { listWorkspaces, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = listWorkspaces();
const vvv = all.find((w) => w.name === 'ввв');
const main = all.find((w) => w.name === 'main');
if (!vvv) { console.error('ввв не найден'); process.exit(1); }

// 1) пишем в ввв заведомо заметные значения
let ini = readWorkspace(vvv.path);
const old48 = ini.Input_IN1['48V'];
const oldGain = ini.Input_IN1['GAIN'];
ini.Input_IN1['48V'] = '1';
ini.Input_IN1['GAIN'] = '99';
writeWorkspace(vvv.path, ini);
console.log(`записал в ввв.ini: 48V 1, GAIN 99 (было 48V=${old48}, GAIN=${oldGain})`);

// 2) переключиться на ввв
const PS_PICK = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(8)',
  '$e.SetFocus()',
  'Start-Sleep -Milliseconds 250',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()',
  '  Start-Sleep -Milliseconds 500',
  '}',
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
  'Start-Sleep -Milliseconds 150',
  'for ($k=0; $k -lt 2; $k++) {',
  '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
  '  Start-Sleep -Milliseconds 120',
  '}',
  '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  'Start-Sleep -Milliseconds 800',
  'Write-Output "PICKED ввв"',
].join('\n');

console.log('переключаю на ввв...');
console.log('  ' + ps(PS_PICK).trim());
await sleep(5000);

// 3) проверить UI и файл
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cx -lt 180 -or $cx -gt 250) { continue }',
  '  $p = $null',
  '  $s = ""',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {',
  '    $s = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString()',
  '  }',
  '  if ($s -eq "") { continue }',
  '  $res += [pscustomobject]@{ x=$cx; y=$cy; s=$s }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const toggles = JSON.parse(ps(RAW));
const tl = Array.isArray(toggles) ? toggles : [toggles];
console.log('\nкнопки IN1 после загрузки ввв:');
for (const t of tl.sort((a, b) => a.y - b.y)) console.log(`  (${t.x},${t.y}) ${t.s}`);

const after = readWorkspace(vvv.path);
console.log(`\nввв.ini после загрузки: 48V=${after.Input_IN1?.['48V']}, GAIN=${after.Input_IN1?.GAIN}`);
console.log(after.Input_IN1?.['48V'] === '1' && after.Input_IN1?.GAIN === '99'
  ? 'MCC сохранил мои значения в файле'
  : 'MCC ПЕРЕЗАПИСАЛ файл своими значениями');
