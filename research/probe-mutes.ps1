Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MPH {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[MPH]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  if ($c.AutomationId -match 'Mute|mute') {
    $tog = ''
    try { $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $tog = 'TOG=' + $tp.Current.ToggleState } catch {}
    $r = $c.BoundingRectangle
    Write-Output ("{0} | {1} | name='{2}' | {3},{4} | {5}" -f $c.ClassName, $c.AutomationId, $c.Name, [int]$r.X, [int]$r.Y, $tog)
  }
}
