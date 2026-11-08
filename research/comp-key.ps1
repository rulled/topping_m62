Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MKB {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[MKB]::SetProcessDPIAware() | Out-Null

$param = $args[0]
$key = $args[1]
$times = [int]$args[2]

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

# читаем label значения в главном окне (labelThresholdValue)
function Read-Label($suffix) {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.AutomationId -like "*$suffix") { return $e.Current.Name }
  }
  return "?"
}

$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hit = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -match "Compressor.*\.$param$") { $hit = $e; break }
}
if ($hit -eq $null) { Write-Output "NOT_FOUND"; exit 1 }

$lbl = if ($param -eq 'Threshold') { 'labelThresholdValue' } elseif ($param -eq 'Gain') { 'labelGainValue' } else { 'NONE' }

$before = if ($lbl -ne 'NONE') { Read-Label $lbl } else { 'n/a' }
Write-Output ("LABEL_BEFORE " + $before)

$hit.SetFocus()
Start-Sleep -Milliseconds 200

for ($i = 0; $i -lt $times; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds 120
}
Start-Sleep -Milliseconds 1200

$after = if ($lbl -ne 'NONE') { Read-Label $lbl } else { 'n/a' }
Write-Output ("LABEL_AFTER " + $after)
