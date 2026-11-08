Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class EW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> Find(uint targetPid) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var txt = new StringBuilder(256); GetWindowText(h, txt, 256);
      RECT r; GetWindowRect(h, out r);
      res.Add(h + "|" + cls + "|" + txt + "|visible=" + IsWindowVisible(h) + "|" + (r.R - r.L) + "x" + (r.B - r.T) + "@" + r.L + "," + r.T);
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$w = [EW]::Find([uint32]$p.Id)
Write-Host ("окон у процесса " + $p.Id + ": " + $w.Count)
foreach ($x in $w) { Write-Host ("  " + $x) }
