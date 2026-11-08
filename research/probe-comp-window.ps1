Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DDC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DDC]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "CompressorS1M1")
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($win -eq $null) {
  # возможно это отдельное top-level окно
  $dr = [System.Windows.Automation.AutomationElement]::RootElement
  $win = $dr.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}
if ($win -eq $null) { Write-Output "NO_COMP_WINDOW"; exit 1 }

$r = $win.Current.BoundingRectangle
Write-Output ("COMPWIN {0},{1} {2}x{3}" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
Write-Output ""

$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ("COUNT " + $all.Count)
Write-Output ""

for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  $rr = $c.BoundingRectangle
  if ($rr.Height -le 0) { continue }
  $pn = ""
  try { if ($e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)) { $pn += "T" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { $pn += "I" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $pn += "V" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)) { $pn += "R" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)) { $pn += "S" } } catch {}
  $val = ""
  try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $val = "VAL=" + $vp.Current.Value } catch {}
  $rv = ""
  try { $rp = $e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern); $rv = ("RV=" + $rp.Current.Value + " [" + $rp.Current.Minimum + ".." + $rp.Current.Maximum + "]") } catch {}
  $tog = ""
  try { $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $tog = "TOG=" + $tp.Current.ToggleState } catch {}
  Write-Output ("{0}|{1}|{2}|{3}|{4},{5}|{6}x{7}|{8}|{9}|{10}|{11}" -f $i, $c.ClassName, $c.AutomationId, $c.Name, [int]$rr.X, [int]$rr.Y, [int]$rr.Width, [int]$rr.Height, $pn, $val, $rv, $tog)
}
