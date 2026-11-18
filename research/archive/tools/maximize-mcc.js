/**
 * РАЗВЕРНУТЬ ОКНО MCC на весь экран.
 *
 * Гипотеза: кнопки реверба (STUDIO/LIVE/HALL/Bypass) появляются
 * только при достаточной ширине окна.
 *
 * Используем SetWindowPos — курсор не трогаем.
 */
import { ps, PRELUDE } from './uia.js';

const RAW = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinPos {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

$hwnd = [IntPtr]$root.Current.NativeWindowHandle
$r = New-Object WinPos+RECT
[WinPos]::GetWindowRect($hwnd, [ref]$r) | Out-Null
Write-Output ("ДО: " + $r.Left + "," + $r.Top + " " + ($r.Right - $r.Left) + "x" + ($r.Bottom - $r.Top))

# SW_MAXIMIZE = 3
[WinPos]::ShowWindow($hwnd, 3) | Out-Null
Start-Sleep -Milliseconds 1200

[WinPos]::GetWindowRect($hwnd, [ref]$r) | Out-Null
Write-Output ("ПОСЛЕ: " + $r.Left + "," + $r.Top + " " + ($r.Right - $r.Left) + "x" + ($r.Bottom - $r.Top))
`;

try {
  console.log(ps(RAW));
} catch (e) {
  console.log('ошибка:', e.message.slice(0, 150));
}
