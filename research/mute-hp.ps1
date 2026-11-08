Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MHP {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[MHP]::SetProcessDPIAware() | Out-Null

# $Target: 'hp' | 'otg'
$Target = 'hp'

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

$needle = if ($Target -eq 'hp') { 'Output_HP' } else { 'Output_OTGOUT' }
$btn = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -like "*$needle*frame.PushButtonMUTE") { $btn = $e; break }
}
if ($btn -eq $null) { Write-Output "NOT_FOUND"; exit 1 }

$tp = $btn.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
Write-Output ("BEFORE " + $tp.Current.ToggleState)
if ($tp.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {
  $tp.Toggle()
  Start-Sleep -Milliseconds 900
  $tp2 = $btn.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  Write-Output ("AFTER " + $tp2.Current.ToggleState)
} else {
  Write-Output "ALREADY_ON"
}
