/**
 * Скриншот окна MCC — чтобы увидеть состояние глазами.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * В Prof-режиме окно EQ наушников не открывается кликом по кнопке
 * PushButtonEQ (i=40). Три способа активации не дали нового окна.
 *
 * При этом в этом же режиме окно РАНЬШЕ было открыто (мы видели
 * EqWidgetIem: 10, ComboBoxS1M3: 10). Значит оно открывается, но
 * как-то иначе, либо клик попадает не туда.
 *
 * Скриншот покажет: где кнопка, что происходит, есть ли окно.
 *
 * Запуск: node src/tools/screenshot-mcc.js [файл.png]
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const out = process.argv[2] ?? path.join('research', 'mcc-screen.png');

const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$procs = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output "NO_PROC"; exit 1 }

# находим главное окно через Win32
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Wnd {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@ -ErrorAction SilentlyContinue

$p = $procs | Select-Object -First 1
$h = $p.MainWindowHandle
if ($h -eq 0) { Write-Output "NO_HANDLE"; exit 1 }

[void][Wnd]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500

$r = New-Object Wnd+RECT
[void][Wnd]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
Write-Output ("RECT " + $r.Left + "," + $r.Top + " " + $w + "x" + $ht)

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
