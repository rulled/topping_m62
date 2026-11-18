/**
 * ОПРЕДЕЛИТЬ: UIA отдаёт ЛОГИЧЕСКИЕ или ФИЗИЧЕСКИЕ координаты?
 *
 * Это ФУНДАМЕНТАЛЬНЫЙ вопрос: все клики мышью пересчитывают координаты
 * через масштаб DPI. Если направление пересчёта неверно, клики бьют мимо.
 *
 * Ключевой факт: процесс PowerShell вызывает SetProcessDPIAware().
 * DPI-aware процесс видит UIA-координаты как ФИЗИЧЕСКИЕ.
 * Не-DPI-aware — как ЛОГИЧЕСКИЕ.
 *
 * Метод: сравнить прямоугольник окна из ДВУХ источников:
 *   - UIA BoundingRectangle (зависит от DPI-awareness вызывающего)
 *   - WinAPI GetWindowRect (ВСЕГДА физические пиксели)
 *
 * Если совпадают -> UIA даёт физические -> пересчёт НЕ НУЖЕН.
 * Если UIA меньше в 1.75 раза -> UIA даёт логические -> пересчёт НУЖЕН.
 *
 * Запуск: node src/tools/dpi-check.js
 */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + String.raw`
# 1. UIA прямоугольник окна MCC
$root = Get-MccRoot
$r = $root.Current.BoundingRectangle
Write-Output ("UIA_X=" + [int]$r.X)
Write-Output ("UIA_Y=" + [int]$r.Y)
Write-Output ("UIA_W=" + [int]$r.Width)
Write-Output ("UIA_H=" + [int]$r.Height)

# 2. WinAPI GetWindowRect — ФИЗИЧЕСКИЕ пиксели, всегда
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WR {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
'@
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$h = $p.MainWindowHandle
$rect = New-Object WR+RECT
[WR]::GetWindowRect($h, [ref]$rect) | Out-Null
Write-Output ("WIN_X=" + $rect.Left)
Write-Output ("WIN_Y=" + $rect.Top)
Write-Output ("WIN_W=" + ($rect.Right - $rect.Left))
Write-Output ("WIN_H=" + ($rect.Bottom - $rect.Top))

# 3. масштаб, который вычисляет PRELUDE
Write-Output ("SCALE=" + $script:scale)
Write-Output ("DPI=" + $script:dpi)

# 4. реальный экран
Write-Output ("SCREEN_W=" + [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width)
Write-Output ("SCREEN_H=" + [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
`;

const out = ps(RAW);
console.log(out);
console.log('\n--- РАЗБОР ---');

const val = (k) => {
  const m = out.match(new RegExp(`^${k}=(-?[\\d.,]+)$`, 'm'));
  return m ? Number(m[1].replace(',', '.')) : null;
};

const uiaW = val('UIA_W');
const uiaH = val('UIA_H');
const winW = val('WIN_W');
const winH = val('WIN_H');
const scale = val('SCALE');

console.log(`UIA:  ${uiaW} x ${uiaH}`);
console.log(`WinAPI: ${winW} x ${winH}`);
console.log(`масштаб по PRELUDE: ${scale}`);

if (uiaW && winW) {
  const ratio = winW / uiaW;
  console.log(`отношение W (WinAPI/UIA) = ${ratio.toFixed(4)}`);
  if (Math.abs(ratio - 1) < 0.02) {
    console.log('\nВЫВОД: UIA отдаёт ФИЗИЧЕСКИЕ пиксели.');
    console.log('  => координаты UIA можно СРАЗУ передавать в SetCursorPos.');
    console.log('  => деление на масштаб ЛОЖНО и уводит клик влево-вверх.');
  } else if (Math.abs(ratio - 1.75) < 0.1) {
    console.log('\nВЫВОД: UIA отдаёт ЛОГИЧЕСКИЕ пиксели (масштаб 1.75).');
    console.log('  => перед SetCursorPos координаты НАДО ДЕЛИТЬ на масштаб.');
  } else {
    console.log(`\nВЫВОД: неожиданное отношение ${ratio.toFixed(4)} — разобрать отдельно.`);
  }
}
