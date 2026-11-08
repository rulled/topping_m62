Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinFix {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);

  public static IntPtr FindMain(uint targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      if (cls.ToString() != "Qt690QWindowIcon") return true;
      var txt = new StringBuilder(256); GetWindowText(h, txt, 256);
      if (txt.ToString() != "M Control Center") return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$h = [WinFix]::FindMain([uint32]$p.Id)
Write-Host ("главное окно: hwnd=" + $h + " visible=" + [WinFix]::IsWindowVisible($h) + " iconic=" + [WinFix]::IsIconic($h))

if ($h -eq [IntPtr]::Zero) {
  Write-Host "НЕ НАЙДЕНО"
  exit 1
}

# SW_SHOW = 5, SW_RESTORE = 9
[WinFix]::ShowWindow($h, 9) | Out-Null   # RESTORE
Start-Sleep -Milliseconds 600
[WinFix]::ShowWindow($h, 5) | Out-Null   # SHOW
Start-Sleep -Milliseconds 800
[WinFix]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500

Write-Host ("после: visible=" + [WinFix]::IsWindowVisible($h) + " iconic=" + [WinFix]::IsIconic($h))
