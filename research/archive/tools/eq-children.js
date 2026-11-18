/**
 * ДЕТИ EQ-ВИДЖЕТОВ: есть ли внутри полосы редактируемое поле?
 *
 * Если у DialS1M5 есть дочерний QLineEdit (как у слайдеров микшера —
 * widgetLinkedVSlider.QLineEdit), то через него можно писать значение
 * напрямую, минуя мышь.
 *
 * Запуск: node src/tools/eq-children.js
 */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $aid = $e.Current.AutomationId
  if ($aid -notlike '*EqWidgetIem*') { continue }
  $r = $e.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width/2)
  $cy = [int]($r.Y + $r.Height/2)
  Write-Output ("[" + $i + "] " + $e.Current.ClassName + " (" + $cx + "," + $cy + ") " + [int]$r.Width + "x" + [int]$r.Height)
  $kids = $e.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($k=0; $k -lt $kids.Count; $k++) {
    $c = $kids.Item($k)
    $cr = $c.Current.BoundingRectangle
    $ccx = [int]($cr.X + $cr.Width/2)
    $ccy = [int]($cr.Y + $cr.Height/2)
    $pats = @()
    $pp = $null
    if ($c.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pp)) { $pats += 'Value' }
    if ($c.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pp)) { $pats += 'Range' }
    if ($c.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pp)) { $pats += 'Invoke' }
    if ($c.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pp)) { $pats += 'Text' }
    Write-Output ("    child[" + $k + "] " + $c.Current.ClassName + " name='" + $c.Current.Name + "' (" + $ccx + "," + $ccy + ") " + [int]$cr.Width + "x" + [int]$cr.Height + " pats=[" + ($pats -join ',') + "]")
  }
}
`;
console.log(ps(RAW));
