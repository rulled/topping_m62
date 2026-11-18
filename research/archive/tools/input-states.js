/** Показать состояние тумблеров входа IN1/IN2 (ToggleState). */
import { ps, PRELUDE } from './uia.js';

const out = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$res = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'QPushButton') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)
  if ($cx -gt 600) { continue }
  $pat = $null
  $st = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $st = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  $txt = $e.Current.Name
  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; w=[int]$r.Width; h=[int]$r.Height; state=$st; text=$txt }
}
$res | ConvertTo-Json -Compress -Depth 3
`);

const rows = JSON.parse(out);
const list = Array.isArray(rows) ? rows : [rows];
list.sort((a, b) => a.x - b.x || a.y - b.y);
console.log('кнопки слева (IN1 x~212, IN2 x~484):\n');
for (const r of list) {
  const which = r.x < 350 ? 'IN1' : r.x < 600 ? 'IN2' : '?';
  console.log(`  [${String(r.i).padStart(3)}] ${which} (${r.x},${r.y}) ${r.w}x${r.h}  state=${r.state.padEnd(5)} "${(r.text || '').replace(/\n/g, '/')}"`);
}
