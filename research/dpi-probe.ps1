Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DDD {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
}
'@

Write-Host "=== ДО SetProcessDPIAware ==="
$dc1 = [DDD]::GetDC([IntPtr]::Zero)
$logx = [DDD]::GetDeviceCaps($dc1, 88)
$logy = [DDD]::GetDeviceCaps($dc1, 90)
$physx = [DDD]::GetDeviceCaps($dc1, 118)
$physy = [DDD]::GetDeviceCaps($dc1, 117)
[DDD]::ReleaseDC([IntPtr]::Zero, $dc1) | Out-Null
Write-Host ("  LOGPIXELSX=" + $logx + " LOGPIXELSY=" + $logy)
Write-Host ("  DESKTOPHORZRES=" + $physx + " DESKTOPVERTRES=" + $physy)
Write-Host ("  масштаб = " + [math]::Round($logx / 96.0, 4))

Write-Host ""
Write-Host "=== ПОСЛЕ SetProcessDPIAware ==="
[DDD]::SetProcessDPIAware() | Out-Null
$dc2 = [DDD]::GetDC([IntPtr]::Zero)
$logx2 = [DDD]::GetDeviceCaps($dc2, 88)
$physx2 = [DDD]::GetDeviceCaps($dc2, 118)
[DDD]::ReleaseDC([IntPtr]::Zero, $dc2) | Out-Null
Write-Host ("  LOGPIXELSX=" + $logx2 + "  DESKTOPHORZRES=" + $physx2)

Write-Host ""
Write-Host "=== ЭКРАНЫ ==="
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  Write-Host ("  " + $s.DeviceName + " bounds=" + $s.Bounds.Width + "x" + $s.Bounds.Height + " primary=" + $s.Primary)
}
