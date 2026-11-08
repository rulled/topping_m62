Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DDX {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DDX]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "FieldEffectS1M1")
$panel = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($panel -eq $null) { Write-Output "NO_PANEL"; exit 1 }

$r = $panel.Current.BoundingRectangle
Write-Output ("PANEL {0} {1} {2} {3}" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
Write-Output ""

$all = $panel.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ("COUNT " + $all.Count)
Write-Output ""

for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  $rr = $c.BoundingRectangle
  if ($rr.Height -le 0) { continue }
  $pats = @()
  try { $pats += "I" } catch {}
  $pn = ""
  try { if ($e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)) { $pn += "T" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { $pn += "I" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $pn += "V" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)) { $pn += "R" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)) { $pn += "S" } } catch {}
  try { if ($e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)) { $pn += "E" } } catch {}
  $val = ""
  try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $val = "value=" + $vp.Current.Value } catch {}
  Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}" -f $i, $c.ClassName, $c.AutomationId, $c.Name, [int]$rr.X, [int]$rr.Y, [int]$rr.Width, [int]$rr.Height, $pn, $val)
}
