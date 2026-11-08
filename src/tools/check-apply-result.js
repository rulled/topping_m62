/**
 * Итоговая проверка гипотезы: применяет ли MCC правки файла при загрузке?
 *
 * Контрольный признак: 48V.
 * В main.ini я поставил 48V=0 (было 0), GAIN=22, MixA_GAIN=7.
 * Если MCC при загрузке применил их — в файле после загрузки останутся
 * те же значения, а в UI кнопка 48V будет off.
 *
 * Более надёжный признак: посмотреть, перезаписал ли MCC файл СВОИМИ
 * значениями (тогда GAIN вернётся к 51).
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace, listWorkspaces } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Сначала: сменим workspace на ввв, потом обратно на main,
// и посмотрим, что станет с нашими правками в main.ini.

const all = listWorkspaces();
console.log('workspaces:');
for (const w of all) console.log(`  ${w.mode}/${w.name} (${w.mtime.toISOString()})`);

const main = all.find((w) => w.name === 'main');
const vvv = all.find((w) => w.name === 'ввв');
if (!main || !vvv) { console.error('нужны main и ввв'); process.exit(1); }

const ini = readWorkspace(main.path);
console.log(`\nmain.ini ДО переключения: GAIN=${ini.Input_IN1?.GAIN}, MixA=${ini.Mixer_IN12?.MixA_GAIN}, 48V=${ini.Input_IN1?.['48V']}`);

// проверим, перезаписал ли MCC файл при прошлой загрузке
const st = (await import('node:fs')).statSync(main.path);
const loadedAt = main.mtime;
console.log(`main.ini mtime: ${loadedAt.toISOString()}`);

// Прочитать, что в UI: кнопки 48V
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
  '  if ($cx -gt 700) { continue }',
  '  $p = $null',
  '  $s = ""',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {',
  '    $s = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString()',
  '  }',
  '  if ($s -eq "") { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; s=$s }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const toggles = JSON.parse(ps(RAW));
const tl = Array.isArray(toggles) ? toggles : [toggles];
console.log('\nкнопки IN1 (x~212):');
for (const t of tl.filter((x) => x.x > 180 && x.x < 250).sort((a, b) => a.y - b.y)) {
  console.log(`  (${t.x},${t.y}) ${t.s}`);
}
