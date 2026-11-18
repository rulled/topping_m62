/**
 * РАЗВЕРНУТЬ ОКНО MCC и снять скриншот.
 *
 * ═══ НАЙДЕНА ПРИЧИНА ═══
 *
 * Окно MCC было свёрнуто в трей:
 *     GetWindowRect -> -32000,-32000 160x28
 * Это координата СКРЫТОГО окна в Windows.
 *
 * Поэтому клики по кнопкам (SetCursorPos + mouse_event) уходили в пустоту:
 * окна на этих координатах нет. Все три способа активации EQ честно
 * возвращали OK, но эффекта не было.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Разворачивает окно через ShowWindow(SW_RESTORE).
 * 2. Проверяет, что координаты стали нормальными.
 * 3. Снимает скриншот.
 *
 * Запуск: node src/tools/restore-window.js
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const out = process.argv[2] ?? path.join('research', 'mcc-restored.png');

const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WndR {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@ -ErrorAction SilentlyContinue

$procs = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output "NO_PROC"; exit 1 }

$p = $procs | Select-Object -First 1
$h = $p.MainWindowHandle
Write-Output ("handle: " + $h)
if ($h -eq 0) { Write-Output "NO_HANDLE"; exit 1 }

Write-Output ("свёрнуто: " + [WndR]::IsIconic($h))

# SW_RESTORE = 9 — развернуть и активировать
[void][WndR]::ShowWindow($h, 9)
Start-Sleep -Milliseconds 800
[void][WndR]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 600

$r = New-Object WndR+RECT
[void][WndR]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
Write-Output ("rect: " + $r.Left + "," + $r.Top + " " + $w + "x" + $ht)

if ($r.Left -lt -10000) {
  Write-Output "ВСЁ ЕЩЁ СКРЫТО"
  exit 2
}

$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save("${out.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "SAVED"
`;

try {
  const r = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    timeout: 60000,
  });
  console.log(r.trim());
  console.log(`\nфайл: ${out}`);
} catch (err) {
  console.error('ERR', err.message);
  process.exit(1);
}
