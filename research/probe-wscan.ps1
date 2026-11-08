Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WScan {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> Find(uint targetPid) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var txt = new StringBuilder(256); GetWindowText(h, txt, 256);
      RECT r; GetWindowRect(h, out r);
      res.Add(h + "|" + cls + "|" + txt + "|vis=" + IsWindowVisible(h) + "|" + (r.R - r.L) + "x" + (r.B - r.T));
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
Write-Host ("PID=" + $p.Id + " MainWindowHandle=" + $p.MainWindowHandle)
foreach ($x in [WScan]::Find([uint32]$p.Id)) { Write-Host ("  " + $x) }

Write-Host ""
Write-Host "=== ЧТО ВИДИТ UIA ==="
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Host ("top-level через UIA: " + $tops.Count)
for ($i = 0; $i -lt $tops.Count; $i++) {
  $w = $tops.Item($i)
  $r = $w.Current.BoundingRectangle
  Write-Host ("  [" + $i + "] cls='" + $w.Current.ClassName + "' name='" + $w.Current.Name + "' " + [int]$r.Width + "x" + [int]$r.Height + " handle=" + $w.Current.NativeWindowHandle)
}
