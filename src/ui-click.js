/**
 * КЛИКИ БЕЗ КУРСОРА — через PostMessage/SendMessage.
 *
 * ЗАЧЕМ: физическая мышь (SetCursorPos + mouse_event) перехватывает
 * курсор пользователя и ломает его работу. Это недопустимо.
 *
 * РЕШЕНИЕ: посылаем WM_LBUTTONDOWN/WM_LBUTTONUP прямо в HWND окна.
 * Курсор не двигается вообще.
 *
 * ВАЖНО: для Qt-приложений дочерних HWND обычно нет — все виджеты
 * рисуются в одном окне, поэтому шлём в главное окно, а Qt сам
 * определяет, какому виджету адресован клик, по координатам.
 *
 * Координаты — КЛИЕНТСКИЕ (от левого верхнего угла клиентской области окна).
 */
import { execFileSync } from 'node:child_process';

const PS = 'powershell.exe';

const PRELUDE_NO_MOUSE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NoMouse {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
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
    return execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch (err) {
    const out = String(err.stdout ?? '') + String(err.stderr ?? '');
    const first = out.split(/\r?\n/).find((l) => l.trim() && !l.includes('at line')) ?? err.message;
    throw new Error(`NoMouse: ${String(first).trim().slice(0, 180)}`);
  }
}

/**
 * Клик по ЛОГИЧЕСКИМ координатам экрана — без движения курсора.
 *
 * Получаем HWND окна, переводим экранные координаты в клиентские,
 * посылаем WM_LBUTTONDOWN + WM_LBUTTONUP.
 *
 * @param {number} lx логический X (как в UIA BoundingRectangle)
 * @param {number} ly логический Y
 * @param {{double?: boolean, button?: 'left'|'right'}} [opts]
 */
export function clickNoCursor(lx, ly, opts = {}) {
  const { double = false, button = 'left' } = opts;
  const down = button === 'right' ? '0x0204' : '0x0201';
  const up = button === 'right' ? '0x0205' : '0x0202';
  const mk = button === 'right' ? '0x0002' : '0x0001';

  const RAW = PRELUDE_NO_MOUSE + [
    // DPI: UIA отдаёт ЛОГИЧЕСКИЕ координаты, окно живёт в ФИЗИЧЕСКИХ.
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class DpiX {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);',
    '  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);',
    '  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);',
    '}',
    '\'@',
    '$dc = [DpiX]::GetDC([IntPtr]::Zero)',
    '$dpi = [DpiX]::GetDeviceCaps($dc, 88)',
    '[DpiX]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null',
    '$scale = $dpi / 96.0',
    '$w = Get-MccWindow',
    '$hwnd = [IntPtr]$w.Current.NativeWindowHandle',
    'if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NO_HWND"; exit 1 }',
    // левый верхний угол клиентской области в ФИЗИЧЕСКИХ экранных координатах
    '$pt = New-Object NoMouse+POINT',
    '$pt.X = 0; $pt.Y = 0',
    '[NoMouse]::ClientToScreen($hwnd, [ref]$pt) | Out-Null',
    // логические -> физические -> клиентские
    `$physX = [int][Math]::Round(${lx} * $scale)`,
    `$physY = [int][Math]::Round(${ly} * $scale)`,
    '$targetX = $physX - $pt.X',
    '$targetY = $physY - $pt.Y',
    '$lp = [IntPtr](($targetY -shl 16) -bor ($targetX -band 0xFFFF))',
    `[NoMouse]::PostMessage($hwnd, ${down}, [IntPtr]${mk}, $lp) | Out-Null`,
    'Start-Sleep -Milliseconds 60',
    `[NoMouse]::PostMessage($hwnd, ${up}, [IntPtr]::Zero, $lp) | Out-Null`,
    ...(double ? [
      'Start-Sleep -Milliseconds 120',
      `[NoMouse]::PostMessage($hwnd, ${down}, [IntPtr]${mk}, $lp) | Out-Null`,
      'Start-Sleep -Milliseconds 60',
      `[NoMouse]::PostMessage($hwnd, ${up}, [IntPtr]::Zero, $lp) | Out-Null`,
    ] : []),
    `Write-Output ("POSTED log=(${lx},${ly}) phys=(" + $physX + "," + $physY + ") client=(" + $targetX + "," + $targetY + ") scale=" + $scale)`,
  ].join('\n');

  return ps(RAW);
}

/**
 * Клик по элементу UIA — берём его BoundingRectangle и шлём PostMessage.
 * @param {{lx:number, ly:number}} el
 * @param {{double?: boolean}} [opts]
 */
export function clickElementNoCursor(el, opts = {}) {
  if (!el || typeof el.lx !== 'number' || typeof el.ly !== 'number') {
    throw new Error('нужен элемент с координатами lx/ly');
  }
  return clickNoCursor(el.lx, el.ly, opts);
}

/** Проверить, что можно получить HWND окна. */
export function mccHwnd() {
  return ps(PRELUDE_NO_MOUSE + [
    '$w = Get-MccWindow',
    'Write-Output $w.Current.NativeWindowHandle',
  ].join('\n'));
}
