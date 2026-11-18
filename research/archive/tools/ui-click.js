/**
 * Правый клик / двойной клик по элементу UI — как в мануале MCC:
 * «Double-click or right-click to open the EQ settings page».
 *
 * Используем SendInput (не mouse_event) и точные экранные координаты центра.
 */
import { execFileSync } from 'node:child_process';

const PS_EXE = 'powershell.exe';

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const x = Number(arg('x', '0'));
const y = Number(arg('y', '0'));
const mode = arg('mode', 'right');   // right | double | left
const waitMs = Number(arg('wait', '1200'));

const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type; public MOUSEINPUT mi;
  }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);

  const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  const uint RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;

  static void Fire(uint flags) {
    INPUT[] a = new INPUT[1];
    a[0].type = 0; // INPUT_MOUSE
    a[0].mi.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void LD() { Fire(LEFTDOWN); }
  public static void LU() { Fire(LEFTUP); }
  public static void RD() { Fire(RIGHTDOWN); }
  public static void RU() { Fire(RIGHTUP); }
}
'@
$null = [S]::Move(${x}, ${y})
Start-Sleep -Milliseconds 250
${mode === 'right' ? '[S]::RD(); Start-Sleep -Milliseconds 120; [S]::RU()' : ''}
${mode === 'double' ? '[S]::LD(); Start-Sleep -Milliseconds 60; [S]::LU(); Start-Sleep -Milliseconds 90; [S]::LD(); Start-Sleep -Milliseconds 60; [S]::LU()' : ''}
${mode === 'left' ? '[S]::LD(); Start-Sleep -Milliseconds 80; [S]::LU()' : ''}
Write-Output "done"
`;

try {
  const out = execFileSync(PS_EXE, ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
  console.log(`${mode}-клик в (${x},${y}): ${out.trim()}`);
  await new Promise((r) => setTimeout(r, waitMs));
} catch (e) {
  console.error('ошибка:', e.message ?? e);
  process.exit(1);
}
