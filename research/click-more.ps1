Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MPC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MPC]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

# найти кнопку MORE по AutomationId
$found = $null
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -like "*buttonMore*") { $found = $e; break }
}
if ($found -eq $null) { Write-Output "NO_MORE_BUTTON"; exit 1 }

$r = $found.Current.BoundingRectangle
$cx = [int]($r.X + $r.Width / 2)
$cy = [int]($r.Y + $r.Height / 2)
Write-Output ("MORE at {0},{1}  rect {2},{3} {4}x{5}" -f $cx, $cy, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)

[MPC]::SetCursorPos($cx, $cy) | Out-Null
Start-Sleep -Milliseconds 300
[MPC]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MPC]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 1200
Write-Output "CLICKED"
