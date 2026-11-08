Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FGW2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
[FGW2]::SetProcessDPIAware() | Out-Null

$param = $args[0]
$key   = $args[1]
$times = [int]$args[2]

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "CompressorS1M1")
$dr = [System.Windows.Automation.AutomationElement]::RootElement
$compWin = $dr.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($compWin -eq $null) { $compWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond) }
if ($compWin -eq $null) { Write-Output "NO_COMPWIN"; exit 1 }

# поднять окно
$hwnd = [IntPtr]$compWin.Current.NativeWindowHandle
$fg = [FGW2]::GetForegroundWindow()
$pidFg = 0
$tidFg = [FGW2]::GetWindowThreadProcessId($fg, [ref]$pidFg)
$tidCur = [FGW2]::GetCurrentThreadId()
[FGW2]::AttachThreadInput($tidCur, $tidFg, $true) | Out-Null
[FGW2]::ShowWindow($hwnd, 5) | Out-Null
[FGW2]::BringWindowToTop($hwnd) | Out-Null
[FGW2]::SetForegroundWindow($hwnd) | Out-Null
[FGW2]::AttachThreadInput($tidCur, $tidFg, $false) | Out-Null
Start-Sleep -Milliseconds 400

# фокус на дил
$all = $compWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hit = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -match "Compressor.*\.$param$") { $hit = $e; break }
}
if ($hit -eq $null) { Write-Output "NO_DIAL"; exit 1 }
$hit.SetFocus()
Start-Sleep -Milliseconds 250

for ($i = 0; $i -lt $times; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds 120
}
Write-Output ("SENT " + $param + " " + $key + " x" + $times)
