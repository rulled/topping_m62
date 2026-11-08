Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FGW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
'@
[FGW]::SetProcessDPIAware() | Out-Null

$param = if ($args.Count -ge 1) { $args[0] } else { 'Threshold' }
$key   = if ($args.Count -ge 2) { $args[1] } else { '{UP}' }
$times = if ($args.Count -ge 3) { [int]$args[2] } else { 3 }

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

# находим окно компрессора как top-level
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "CompressorS1M1")
$dr = [System.Windows.Automation.AutomationElement]::RootElement
$compWin = $dr.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($compWin -eq $null) {
  $compWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}
if ($compWin -eq $null) { Write-Output "NO_COMPWIN"; exit 1 }

$hwnd = [IntPtr]$compWin.Current.NativeWindowHandle
Write-Output ("COMPWIN hwnd=" + $hwnd)

# поднимаем окно
try {
  $fg = [FGW]::GetForegroundWindow()
  $tidFg = 0
  $pidFg = 0
  $tidFg = [FGW]::GetWindowThreadProcessId($fg, [ref]$pidFg)
  $tidCur = [FGW]::GetCurrentThreadId()
  [FGW]::AttachThreadInput($tidCur, $tidFg, $true) | Out-Null
  [FGW]::ShowWindow($hwnd, 5) | Out-Null
  [FGW]::BringWindowToTop($hwnd) | Out-Null
  [FGW]::SetForegroundWindow($hwnd) | Out-Null
  [FGW]::AttachThreadInput($tidCur, $tidFg, $false) | Out-Null
} catch { Write-Output ("FG_ERR " + $_) }
Start-Sleep -Milliseconds 600

$fg2 = [FGW]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[FGW]::GetWindowText($fg2, $sb, 256) | Out-Null
Write-Output ("FOREGROUND_NOW hwnd=" + $fg2 + " title='" + $sb.ToString() + "'")

# читаем значения
function Read-All {
  $all = $compWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $res = @()
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.ClassName -eq 'QLabel' -and $e.Current.Name -match '^-?\d') {
      $res += $e.Current.Name
    }
  }
  return ($res -join ',')
}
Write-Output ("LABELS_BEFORE " + (Read-All))

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
Write-Output ("FOCUSED " + $hit.Current.AutomationId)

for ($i = 0; $i -lt $times; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds 120
}
Start-Sleep -Milliseconds 1400
Write-Output ("LABELS_AFTER " + (Read-All))
