/**
 * ПРОВЕРКА: GAIN входа — ходит ли он через HID синхронно с файлом?
 *
 * 1) читаем Input_IN1.GAIN из файла
 * 2) читаем 0x21:0x04 из HID
 * 3) меняем GAIN через UI (перетаскивание dial с DPI-коррекцией)
 * 4) читаем оба снова
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS_EXE = 'powershell.exe';

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const fileGain = () => {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return ini.Input_IN1?.GAIN;
};

console.log('=== ДО ===');
console.log(`  файл Input_IN1.GAIN = ${fileGain()}`);
let s = await snap();
console.log(`  HID 0x21:0x04 = ${s.get(0x2104) ?? '—'}`);

// найти dial GAIN IN1
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -notmatch "Dial") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const dials = JSON.parse(ps(RAW));
const dl = (Array.isArray(dials) ? dials : [dials]);
const in1 = dl.find((d) => d.x > 130 && d.x < 200 && d.y > 650 && d.y < 760);
if (!in1) {
  console.log('\ndial GAIN IN1 не найден, доступные:', JSON.stringify(dl.slice(0, 6)));
  process.exit(1);
}
console.log(`\ndial GAIN IN1: [${in1.i}] логические (${in1.x},${in1.y})`);

// DPI-коррекция: масштаб 1.75
const px = Math.round(in1.x / 1.75);
const py = Math.round(in1.y / 1.75);
console.log(`  физические (${px},${py})`);

const DRAG = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MS2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MS2]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MS2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 200
for ($i=1; $i -le 10; $i++) {
  [MS2]::SetCursorPos(${px}, ${py} - ($i * 3))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 200
[MS2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "ok"
`;
console.log('\nтяну dial вверх (уменьшаю GAIN)...');
execFileSync(PS_EXE, ['-NoProfile', '-Command', DRAG], { encoding: 'utf8' });
await sleep(2500);

console.log('\n=== ПОСЛЕ ===');
console.log(`  файл Input_IN1.GAIN = ${fileGain()}`);
s = await snap();
console.log(`  HID 0x21:0x04 = ${s.get(0x2104) ?? '—'}`);
dev.close();
process.exit(0);
