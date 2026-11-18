/**
 * Можно ли записать значение компрессора через QLabel [385]?
 * Это отображение Threshold. Проверяем, есть ли у него Value-паттерн для записи.
 */
import { ps, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const thr = () => {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path).Compressor?.Threshold;
};

console.log('Threshold в файле:', thr());

// проверяем паттерны у [385]
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$e = $all.Item(385)',
  'Write-Output ("CLS=" + $e.Current.ClassName + " NAME=" + $e.Current.Name)',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
  '  $vp = [System.Windows.Automation.ValuePattern]$p',
  '  Write-Output ("VALUE=[" + $vp.Current.Value + "] RO=" + $vp.Current.IsReadOnly)',
  '} else { Write-Output "NOVALUE" }',
  '$p2 = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p2)) { Write-Output "HAS TEXT" }',
].join('\n');
console.log('\nпаттерны [385]:');
console.log(ps(RAW));

// есть ли рядом QLineEdit, скрытый?
console.log('\nвсе QLineEdit в окне (первые 10 с координатами):');
const RAW2 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLineEdit") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  $v = ""',
  '  $p = $null',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); w=[int]$r.Width; h=[int]$r.Height; v=$v }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
try {
  const arr = JSON.parse(ps(RAW2));
  const list = Array.isArray(arr) ? arr : [arr];
  console.log(`  всего QLineEdit: ${list.length}`);
  for (const e of list.filter((x) => x.y > 1100 && x.y < 1700).slice(0, 10)) {
    console.log(`    [${e.i}] (${e.x},${e.y}) ${e.w}x${e.h} v="${e.v}"`);
  }
} catch (e) { console.log('  ошибка:', e.message); }

