/**
 * Как MCC пишет компрессор? Меняем через dial в UI и смотрим файл.
 *
 * На панели эффектов есть Threshold (758,1246) и dial под ним.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS_EXE = 'powershell.exe';

function comp() {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return {
    switch: ini.Compressor?.Switch,
    threshold: ini.Compressor?.Threshold,
    ratio: ini.Compressor?.Ratio,
    attack: ini.Compressor?.Attack,
    release: ini.Compressor?.Release,
    gain: ini.Compressor?.Gain,
    mix: ini.Compressor?.Mix,
  };
}

console.log('ДО:', JSON.stringify(comp()));

// найти dial'ы на панели компрессора
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -notmatch "Dial") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); c=$e.Current.ClassName }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const arr = JSON.parse(ps(RAW));
const dl = (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.y - b.y || a.x - b.x);
console.log(`\ndial'ов найдено: ${dl.length}`);
for (const d of dl) console.log(`  [${d.i}] ${d.c.padEnd(10)} (${d.x},${d.y})`);

// Threshold dial: рядом с подписью Threshold (758,1246)
const th = dl.find((d) => Math.abs(d.x - 758) < 60 && d.y > 1250 && d.y < 1400);
if (!th) { console.log('\nThreshold dial не найден'); process.exit(0); }
console.log(`\nThreshold dial: [${th.i}] (${th.x},${th.y})`);

const px = Math.round(th.x / 1.75);
const py = Math.round(th.y / 1.75);
console.log(`  физические: (${px},${py})`);

const DRAG = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MS3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MS3]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MS3]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 200
for ($i=1; $i -le 10; $i++) {
  [MS3]::SetCursorPos(${px}, ${py} + ($i * 4))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 200
[MS3]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "ok"
`;
console.log('\nтяну Threshold dial вниз...');
execFileSync(PS_EXE, ['-NoProfile', '-Command', DRAG], { encoding: 'utf8' });
await sleep(2500);

console.log('\nПОСЛЕ:', JSON.stringify(comp()));
