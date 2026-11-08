/**
 * ИЗМЕНЕНИЕ ЗНАЧЕНИЙ ДИАЛА БЕЗ КУРСОРА.
 *
 * Идея: послать WM_MOUSEWHEEL прямо в HWND окна с координатами диала.
 * Курсор не двигается.
 *
 * WM_MOUSEWHEEL (0x020A): wParam = (delta << 16) | keys,
 * lParam = ЭКРАННЫЕ координаты (не клиентские!) в упакованном виде.
 *
 * ВАЖНО: для WM_MOUSEWHEEL lParam должен быть в ЭКРАННЫХ координатах,
 * в отличие от WM_LBUTTONDOWN, где координаты клиентские.
 */
import { execFileSync } from 'node:child_process';

const PRELUDE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WheelNoCursor {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@

function Get-MccWindow {
  $p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
  $tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  for ($i = 0; $i -lt $tops.Count; $i++) {
    $w = $tops.Item($i)
    if ($w.Current.ClassName -eq "MainWindow_M62") { return $w }
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
`;

function ps(cmd) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch (err) {
    const out = String(err.stdout ?? '') + String(err.stderr ?? '');
    const first = out.split(/\r?\n/).find((l) => l.trim() && !l.includes('at line')) ?? err.message;
    throw new Error(`WheelNoCursor: ${String(first).trim().slice(0, 180)}`);
  }
}

/**
 * Прокрутить колесо над точкой — без движения курсора.
 *
 * @param {number} lx логический X (UIA)
 * @param {number} ly логический Y
 * @param {number} notches сколько щелчков (положительное — вверх/больше)
 */
export function wheelNoCursor(lx, ly, notches) {
  const n = Math.abs(Math.round(notches));
  const up = notches >= 0;
  const delta = up ? 120 : -120;

  const RAW = PRELUDE + [
    '$dc = [WheelNoCursor]::GetDC([IntPtr]::Zero)',
    '$dpi = [WheelNoCursor]::GetDeviceCaps($dc, 88)',
    '[WheelNoCursor]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null',
    '$scale = $dpi / 96.0',
    '$w = Get-MccWindow',
    '$hwnd = [IntPtr]$w.Current.NativeWindowHandle',
    'if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NO_HWND"; exit 1 }',
    '$pt = New-Object WheelNoCursor+POINT',
    '$pt.X = 0; $pt.Y = 0',
    '[WheelNoCursor]::ClientToScreen($hwnd, [ref]$pt) | Out-Null',
    // физические ЭКРАННЫЕ координаты точки
    `$physX = [int][Math]::Round(${lx} * $scale)`,
    `$physY = [int][Math]::Round(${ly} * $scale)`,
    '$lp = [IntPtr](($physY -shl 16) -bor ($physX -band 0xFFFF))',
    // wParam: старшие 16 бит = delta, младшие = ключи (0)
    `$wpVal = ${delta} -shl 16`,
    '$wp = [IntPtr]$wpVal',
    `for ($i = 0; $i -lt ${n}; $i++) {`,
    '  [WheelNoCursor]::SendMessage($hwnd, 0x020A, $wp, $lp) | Out-Null',
    '  Start-Sleep -Milliseconds 45',
    '}',
    `Write-Output ("WHEEL n=${n} at screen=(" + $physX + "," + $physY + ") delta=" + ${delta})`,
  ].join('\n');

  return ps(RAW);
}

