Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WAC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
'@
[WAC]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
Write-Output ("MCC PID = " + $p.Id)

$fg = [WAC]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[WAC]::GetWindowText($fg, $sb, 256) | Out-Null
Write-Output ("FOREGROUND hwnd=" + $fg + " title='" + $sb.ToString() + "'")

Write-Output ""
Write-Output "=== ОКНА MCC ==="
# перебираем top-level окна процесса
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class EW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
  public static List<string> Find(uint pid) {
    List<string> res = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint wp; GetWindowThreadProcessId(h, out wp);
      if (wp == pid) {
        StringBuilder c = new StringBuilder(256), t = new StringBuilder(256);
        GetClassName(h, c, 256); GetWindowText(h, t, 256);
        RECT r; GetWindowRect(h, out r);
        res.Add(h.ToInt64() + "|" + c.ToString() + "|" + t.ToString() + "|vis=" + IsWindowVisible(h) + "|" + r.L + "," + r.T + "," + (r.R-r.L) + "x" + (r.B-r.T));
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@
$wins = [EW]::Find([uint32]$p.Id)
foreach ($w in $wins) { Write-Output $w }
