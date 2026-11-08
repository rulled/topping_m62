/**
 * РЕШАЮЩИЙ ТЕСТ ЗАПИСИ: применяет ли MCC правку файла при СТАРТЕ?
 *
 * 1) пишем в активный файл заведомо другие значения микшера
 * 2) полностью закрываем MCC
 * 3) запускаем MCC
 * 4) смотрим: значение в UI и в файле — моё или MCC вернул своё?
 */
import { copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { dumpTree, ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS_EXE = 'powershell.exe';
const MCC = String.raw`C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe`;

const ws = findActiveWorkspace();
console.log(`активный workspace: ${ws.mode}/${ws.name}`);
console.log(`путь: ${ws.path}\n`);

// бэкап при ЗАКРЫТОМ MCC
execFileSync(PS_EXE, ['-NoProfile', '-Command', 'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue'], { encoding: 'utf8' });
await sleep(4000);
const backup = ws.path + '.decide.bak';
copyFileSync(ws.path, backup);
console.log(`бэкап (при закрытом MCC): ${backup}`);

// читаем исходное
let ini = readWorkspace(ws.path);
const oldGain = ini.Input_IN1?.['GAIN'];
const oldMixA = ini.Mixer_IN12?.MixA_GAIN;
console.log(`ДО: GAIN=${oldGain}, MixA_GAIN=${oldMixA}`);

// пишем заведомо другие
ini.Input_IN1['GAIN'] = '11';
ini.Mixer_IN12['MixA_GAIN'] = '5';
ini.Mixer_IN12['MixA_MUTE'] = 'true';
writeWorkspace(ws.path, ini);
console.log(`записал: GAIN=11, MixA_GAIN=5, MixA_MUTE=true`);

// запускаем MCC
console.log('\nзапускаю MCC...');
execFileSync(PS_EXE, ['-NoProfile', '-Command', 'Start-Process "' + MCC + '"'], { encoding: 'utf8' });
await sleep(13000);

// что стало в файле
const after = readWorkspace(ws.path);
console.log('\n=== ПОСЛЕ ЗАПУСКА MCC ===');
console.log(`файл: GAIN=${after.Input_IN1?.['GAIN']}, MixA_GAIN=${after.Mixer_IN12?.MixA_GAIN}, MixA_MUTE=${after.Mixer_IN12?.MixA_MUTE}`);

const gainKept = after.Input_IN1?.['GAIN'] === '11';
const mixKept = after.Mixer_IN12?.MixA_GAIN === '5';
console.log(`  GAIN сохранён моим: ${gainKept ? 'ДА' : 'нет (MCC вернул ' + after.Input_IN1?.['GAIN'] + ')'}`);
console.log(`  MixA_GAIN сохранён моим: ${mixKept ? 'ДА' : 'нет (MCC вернул ' + after.Mixer_IN12?.MixA_GAIN + ')'}`);

// проверяем UI: слайдер Mix A
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QSlider") { continue }',
  '  $p = $null',
  '  if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { continue }',
  '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $res += [pscustomobject]@{ x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); v=$rv.Current.Value; min=$rv.Current.Minimum; max=$rv.Current.Maximum }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

try {
  const sl = JSON.parse(ps(RAW));
  const list = Array.isArray(sl) ? sl : [sl];
  const mix = list.filter((s) => s.min === -90 && s.max === 12);
  console.log(`\nслайдеры микшера в UI (${mix.length}):`);
  for (const s of mix.slice(0, 12)) console.log(`  (${s.x},${s.y}) = ${s.v}`);
} catch (e) {
  console.log('\nне удалось прочитать слайдеры:', e.message);
}

console.log(`\nбэкап для отката: ${backup}`);
