Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VM {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[VM]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current
  if ($c.ClassName -notmatch 'VolumeMeter|ProgressBar') { continue }
  $val = ''
  try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $val = 'VAL=' + $vp.Current.Value } catch { $val = 'VAL=n/a' }
  $rv = ''
  try { $rp = $e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern); $rv = "RV=$($rp.Current.Value)[$($rp.Current.Minimum)..$($rp.Current.Maximum)]" } catch { $rv = 'RV=n/a' }
  $nm = $c.AutomationId.Split('.')[-1]
  Write-Output ("{0} | {1} | {2} | {3}" -f $c.ClassName, $nm, $val, $rv)
}
