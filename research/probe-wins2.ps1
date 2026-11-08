Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class EWC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
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
[EWC]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
Write-Output "=== WinAPI windows ==="
foreach ($w in [EWC]::Find([uint32]$p.Id)) { Write-Output $w }

Write-Output ""
Write-Output "=== UIA top-level (RootElement children) ==="
$dr = [System.Windows.Automation.AutomationElement]::RootElement
$kids = $dr.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $kids.Count; $i++) {
  $e = $kids.Item($i)
  $c = $e.Current
  Write-Output ("{0} | cls={1} | name='{2}' | hwnd={3}" -f $i, $c.ClassName, $c.Name, $c.NativeWindowHandle)
}
