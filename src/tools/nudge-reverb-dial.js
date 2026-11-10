/**
 * ДВИНУТЬ ДИЛ РЕВЕРБА В MCC — фокус + стрелки.
 *
 * ═══ ПОЧЕМУ ТАК ═══
 *
 * Дилы реверба не имеют RangeValuePattern: только Value (пустое)
 * и Invoke. Значит значение читается НЕ из них, а из HID, а менять
 * можно только стрелками после SetFocus.
 *
 * ═══ КООРДИНАТЫ (окно 1650x967 при x=8 y=31) ═══
 *
 * Подписи в окне и дилы рядом с ними:
 *
 *   'Dry'  x=522 y=648     'Wet' x=623 y=648
 *   'Room Size' x=512 y=683
 *   'Decay' x=512 y=753    'Width' x=585 y=753
 *
 * Дилы в области эффектов:
 *   564,702  -> между Dry и Wet  = Dry/Wet
 *   512,772  -> под Room Size    = Room Size
 *   585,772  -> под Width        = Width
 *   413,817  -> левее, ниже      = Decay (нужна проверка)
 *
 * Эти координаты — гипотеза из расположения подписей. Скрипт
 * проверяет её снимком HID: если после сдвига изменился ожидаемый
 * тег, координата верна.
 *
 * Запуск: node src/tools/nudge-reverb-dial.js dryWet +3
 *        node src/tools/nudge-reverb-dial.js room -2
 */

import { execFileSync } from 'node:child_process';

const DIALS = {
  dryWet: { x: 564, y: 702 },
  room: { x: 512, y: 772 },
  width: { x: 585, y: 772 },
  decay: { x: 413, y: 817 },
};

const which = process.argv[2];
const notches = Number(process.argv[3] ?? 1);

if (!which || !DIALS[which]) {
  console.error(`использование: node nudge-reverb-dial.js <${Object.keys(DIALS).join('|')}> <стрелок>`);
  process.exit(2);
}
if (!Number.isFinite(notches) || notches === 0) {
  console.error('стрелок должно быть числом ≠ 0');
  process.exit(2);
}

const { x, y } = DIALS[which];
const key = notches > 0 ? '{UP}' : '{DOWN}';
const times = Math.abs(notches);

const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500

# клик по дилу, чтобы он получил фокус
[W]::SetCursorPos(${x}, ${y}) | Out-Null
Start-Sleep -Milliseconds 200
[W]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # left down
Start-Sleep -Milliseconds 80
[W]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # left up
Start-Sleep -Milliseconds 500

Add-Type -AssemblyName System.Windows.Forms
for ($i = 0; $i -lt ${times}; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait("${key}")
  Start-Sleep -Milliseconds 120
}
Write-Output "SENT:${times}"
`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 60000 });
  console.log(`дил ${which} (${x},${y}): ${out.trim()}`);
} catch (err) {
  console.error(`ошибка: ${String(err.message).slice(0, 200)}`);
  process.exit(1);
}
