/**
 * Найти кнопки управления ревербом.
 * Диффим файл при нажатии каждой кнопки нижней панели.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fx() {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    reverbType: i.Effect_Integration?.ReverbType,
    muteFX: i.Effect_Integration?.MuteFX,
    ncType: i.Effect_Integration?.NoiseReductionType,
    dryWetStudio: i.Effect_Integration?.DryWetStudio,
    reverbStudio: i.Effect_Integration?.ReverbStudio,
  };
}

function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
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
    '$e = $all.Item($best)', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output ("OK " + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// сначала откроем панель эффектов (MORE)
console.log('нажимаю MORE для открытия панели эффектов');
const { dumpTree } = await import('./uia.js');
const { items } = dumpTree();
const more = items.find((x) => (x.name || '').trim() === 'MORE');
if (more) {
  await ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
    '$e = $all.Item(' + more.i + ')', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { ([System.Windows.Automation.InvokePattern]$p).Invoke() }',
  ].join('\n'));
  await sleep(2000);
}

// найдём все QPushButton с Toggle в нижней области
const RAW = PRELUDE + [
  '$root = Get-MccRoot', '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cy -lt 1500) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=$cy }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const arr = JSON.parse(ps(RAW));
const btns = Array.isArray(arr) ? arr : [arr];
console.log(`кнопок в нижней панели: ${btns.length}`);

console.log('\nбазовое состояние:', JSON.stringify(fx()));

for (const b of btns) {
  const before = fx();
  const r = clickAt(b.x, b.y);
  await sleep(1200);
  const after = fx();
  const diffs = Object.keys(after).filter((k) => before[k] !== after[k]);
  console.log(`(${String(b.x).padStart(4)},${b.y}) ${r.padEnd(10)} ${diffs.length ? diffs.map((k) => k + ': ' + before[k] + '->' + after[k]).join(', ') : '—'}`);
  if (diffs.length) { clickAt(b.x, b.y); await sleep(700); }
}
