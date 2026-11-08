/**
 * Проверка: доступен ли компрессор в Live-режиме?
 *
 * Щёлкаем кнопку компрессора в UI и смотрим, меняется ли Switch в файле.
 * Если MCC не даёт его включить — значит блок недоступен, как EQ.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function compState() {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return {
    switch: ini.Compressor?.Switch,
    threshold: ini.Compressor?.Threshold,
    ratio: ini.Compressor?.Ratio,
  };
}

console.log('ДО:', JSON.stringify(compState()));

// кнопка компрессора была [385] около (758,1637)
function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = Get-MccAll $root',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
    '  $d = [Math]::Abs($cx - ' + lx + ') + [Math]::Abs($cy - ' + ly + ')',
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output "NF"; exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK " + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// список кнопок нижней панели для поиска компрессора
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cy -lt 1550) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=$cy }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const btns = JSON.parse(ps(RAW));
const bl = Array.isArray(btns) ? btns : [btns];
console.log(`\nкнопки нижней панели (y>1550): ${bl.length}`);
for (const b of bl) console.log(`  [${b.i}] (${b.x},${b.y})`);

for (const b of bl) {
  const before = compState();
  const r = clickAt(b.x, b.y);
  await sleep(1500);
  const after = compState();
  const changed = before.switch !== after.switch || before.threshold !== after.threshold;
  console.log(`  (${b.x},${b.y}) ${r.padEnd(10)} switch: ${before.switch} -> ${after.switch}${changed ? '  <<< Компрессор!' : ''}`);
  if (changed) {
    clickAt(b.x, b.y);
    await sleep(800);
  }
}
