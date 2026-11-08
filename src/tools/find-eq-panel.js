/** Состояние кнопок нижней панели + поиск EQ-панели. */
import { ps, PRELUDE } from './uia.js';

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
  '  $p = $null',
  '  $st = ""',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {',
  '    $st = ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState.ToString()',
  '  }',
  '  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; w=[int]$r.Width; h=[int]$r.Height; s=$st; n=$e.Current.Name }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

const arr = JSON.parse(ps(RAW));
const list = Array.isArray(arr) ? arr : [arr];

console.log('=== кнопки в нижней области (y > 1400) ===');
for (const b of list.filter((x) => x.y > 1400).sort((a, b) => a.y - b.y || a.x - b.x)) {
  console.log(`[${String(b.i).padStart(3)}] (${b.x},${b.y}) ${b.w}x${b.h} state=${(b.s || '—').padEnd(5)} "${(b.n || '').replace(/\n/g, '/')}"`);
}

console.log('\n=== подписи в нижней области ===');
const LAB = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLabel") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cy -lt 1400) { continue }',
  '  $n = $e.Current.Name',
  '  if (-not $n -or -not $n.Trim()) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=$cy; n=$n }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const labs = JSON.parse(ps(LAB));
const ll = Array.isArray(labs) ? labs : [labs];
for (const l of ll.sort((a, b) => a.y - b.y || a.x - b.x)) {
  console.log(`[${String(l.i).padStart(3)}] (${l.x},${l.y}) "${(l.n || '').replace(/\n/g, '/')}"`);
}
