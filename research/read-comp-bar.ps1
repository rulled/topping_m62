Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RCB {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[RCB]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "CompressorS1M1")
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($win -eq $null) { Write-Output "NO_COMPWIN"; exit 1 }

$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -match 'compressMeter') {
    try {
      $rp = $e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
      Write-Output ([string][math]::Round($rp.Current.Value, 1))
      exit 0
    } catch { Write-Output "RV_ERR"; exit 1 }
  }
}
Write-Output "NOT_FOUND"
