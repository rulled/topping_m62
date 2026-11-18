/** Найти отображение значения GAIN входа IN1 в UI (число рядом с dial). */
import { ps, PRELUDE } from './uia.js';

// dial GAIN IN1 обычно около (164,699); значение показывается рядом
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLabel") { continue }',
  '  $n = $e.Current.Name',
  '  if (-not $n -or -not $n.Trim()) { continue }',
  '  if ($n -notmatch "^[0-9.+-]+$") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; n=$n }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const arr = JSON.parse(ps(RAW));
const list = Array.isArray(arr) ? arr : [arr];
console.log(`числовых подписей: ${list.length}\n`);
console.log('в области входов (x < 400):');
for (const l of list.filter((x) => x.x < 400).sort((a, b) => a.y - b.y || a.x - b.x)) {
  console.log(`  (${String(l.x).padStart(3)},${String(l.y).padStart(4)}) "${l.n}"`);
}
