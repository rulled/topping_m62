/**
 * Движение круглого регулятора (Dial) мышью.
 *
 * Dial не поддерживает RangeValue, поэтому действуем как пользователь:
 * ставим курсор на центр, зажимаем ЛКМ, тянем вверх/вниз, отпускаем.
 *
 * Пишет в устройство M Control Center — не мы. Мы только двигаем мышь
 * и слушаем HID.
 *
 * Запуск:
 *   node src/tools/dial-drag.js --x 1016 --y 386 --dy -60
 *   node src/tools/dial-drag.js --x 1016 --y 386 --dy 60
 */
import { execFileSync } from 'node:child_process';

const PS_EXE = 'powershell.exe';

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const x = Number(arg('x', '0'));
const y = Number(arg('y', '0'));
const dy = Number(arg('dy', '-40'));

const DRAG = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP   = 0x0004;
  public static void Move(int x,int y){ SetCursorPos(x,y); }
  public static void Down(){ mouse_event(LEFTDOWN,0,0,0,IntPtr.Zero); }
  public static void Up(){ mouse_event(LEFTUP,0,0,0,IntPtr.Zero); }
}
'@
[M]::Move(${x}, ${y})
Start-Sleep -Milliseconds 200
[M]::Down()
Start-Sleep -Milliseconds 150
$steps = 12
for ($i=1; $i -le $steps; $i++) {
  $ny = ${y} + [int]((${dy} / $steps) * $i)
  [M]::Move(${x}, $ny)
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 150
[M]::Up()
Write-Output "drag done x=${x} y=${y} dy=${dy}"
`;

try {
  const out = execFileSync(PS_EXE, ['-NoProfile', '-Command', DRAG], { encoding: 'utf8' });
  console.log(out.trim());
} catch (e) {
  console.error('ошибка:', e.message ?? e);
  process.exit(1);
}
