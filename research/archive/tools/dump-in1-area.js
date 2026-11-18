/** Все подписи и числа в области IN1 (x 100..260). */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cx -lt 90 -or $cx -gt 300) { continue }',
  '  if ($cy -lt 150 -or $cy -gt 900) { continue }',
  '  $n = $e.Current.Name',
  '  if (-not $n -or -not $n.Trim()) { continue }',
  '  $res += [pscustomobject]@{ c=$e.Current.ClassName; x=$cx; y=$cy; n=$n }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

const arr = JSON.parse(ps(RAW));
const list = Array.isArray(arr) ? arr : [arr];
console.log('элементы в области IN1:');
for (const e of list.sort((a, b) => a.y - b.y || a.x - b.x)) {
  console.log(`  (${String(e.x).padStart(3)},${String(e.y).padStart(4)}) ${e.c.padEnd(16)} "${(e.n || '').replace(/\n/g, '/')}"`);
}
