/**
 * CLICK DIAL с учётом DPI.
 *
 * Dial не поддерживает RangeValue, поэтому двигаем мышью:
 * клик по dial'у открывает ввод, либо drag меняет значение.
 *
 * ВАЖНО: координаты UIA — ЛОГИЧЕСКИЕ, а мышь — ФИЗИЧЕСКИЕ.
 * На этой машине DPI=168, масштаб 1.75. Делим.
 */
import { execFileSync } from 'node:child_process';
import { ps, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS_EXE = 'powershell.exe';

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const idx = Number(arg('idx', '-1'));
const dy = Number(arg('dy', '40'));
if (idx < 0) { console.error('укажи --idx'); process.exit(1); }

// получить координаты и масштаб
const info = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$r = $e.Current.BoundingRectangle
Write-Output ("LX=" + [int]($r.X + $r.Width/2) + ";LY=" + [int]($r.Y + $r.Height/2) + ";SCALE=" + $script:scale)
`).trim();
const m = info.match(/LX=(\d+);LY=(\d+);SCALE=([\d.]+)/);
if (!m) { console.error('не удалось получить координаты:', info); process.exit(1); }
const lx = Number(m[1]), ly = Number(m[2]), scale = Number(m[3]);
const px = Math.round(lx / scale);
const py = Math.round(ly / scale);
console.log(`dial[${idx}] логические (${lx},${ly}) -> физические (${px},${py}), scale=${scale}`);

const ws = findActiveWorkspace();
const grab = () => {
  const ini = readWorkspace(ws.path);
  return { in1: ini.Input_IN1?.GAIN, in2: ini.Input_IN2?.GAIN };
};
console.log('ДО:', JSON.stringify(grab()));

// drag мышью
const DRAG = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MS {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  public static void Down() { mouse_event(0x0002,0,0,0,IntPtr.Zero); }
  public static void Up()   { mouse_event(0x0004,0,0,0,IntPtr.Zero); }
}
'@
[MS]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MS]::Down()
Start-Sleep -Milliseconds 200
$steps = 10
for ($i=1; $i -le $steps; $i++) {
  $ny = ${py} + [int]((${dy} / $steps) * $i)
  [MS]::SetCursorPos(${px}, $ny)
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 200
[MS]::Up()
Write-Output "dragged"
`;
console.log('тяну мышь...');
console.log('  ' + execFileSync(PS_EXE, ['-NoProfile', '-Command', DRAG], { encoding: 'utf8' }).trim());

await sleep(2500);
console.log('ПОСЛЕ:', JSON.stringify(grab()));
