# Снять все текстовые подписи с числовыми/dB значениями в главном окне MCC.
# Ищем QLabel, чей текст похож на уровень: "0", "-12.3", "-∞", "-INF".
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class LBL {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[LBL]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  if ($c.ClassName -ne 'QLabel') { continue }
  $t = $c.Name
  if ($t -eq '' -or $t -eq $null) { continue }
  $r = $c.BoundingRectangle
  if ($r.Height -le 0) { continue }
  # только правдоподобные уровни
  if ($t -match '^[-+]?\d+(\.\d+)?$' -or $t -match '∞' -or $t -match 'inf' -or $t -match '^-$') {
    Write-Output ("{0}|{1}|{2}" -f $t, [int]$r.X, [int]$r.Y, $c.AutomationId)
  }
}
