Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RFX {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[RFX]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

$out = @()
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  if ($c.ClassName -ne 'QLabel') { continue }
  # уровни: labelInputLevel1, labelInput2Level, labelAuxLevel, labelBluetoothLevel, labelOtgLevel
  if ($c.AutomationId -match 'Level') {
    $out += ($c.AutomationId.Split('.')[-1] + '=' + $c.Name)
  }
}
Write-Output ($out -join ' ; ')
