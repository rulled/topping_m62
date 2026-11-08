/** Утилиты чтения состояния UI MCC. */
import { ps, PRELUDE } from './uia.js';

/** Состояния всех тумблеров слева (входы). */
export function inputStates() {
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
  if ($cx -gt 700) { continue }
  $pat = $null
  $st = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $st = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  if ($st -eq '') { continue }
  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; w=[int]$r.Width; h=[int]$r.Height; state=$st; text=$e.Current.Name }
}
$res | ConvertTo-Json -Compress -Depth 3
`);
  const arr = JSON.parse(out);
  return Array.isArray(arr) ? arr : [arr];
}

/** Все тумблеры в заданной области. */
export function togglesInArea(minX, maxX, minY, maxY) {
  return inputStates().filter(
    (s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY,
  );
}
