/**
 * Есть ли у dial компрессора редактируемое поле ввода?
 * Двойной клик по dial часто открывает ввод.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS_EXE = 'powershell.exe';

const thr = () => {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path).Compressor?.Threshold;
};

console.log('Threshold сейчас =', thr());

const px = Math.round(756 / 1.75);
const py = Math.round(1302 / 1.75);

// двойной клик по dial
const DBL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MS5 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MS5]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MS5]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MS5]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 100
[MS5]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MS5]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 600
Write-Output "dbl"
`;
console.log('двойной клик по dial...');
execFileSync(PS_EXE, ['-NoProfile', '-Command', DBL], { encoding: 'utf8' });
await sleep(1500);

// ищем QLineEdit, ставший видимым
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLineEdit") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $v = ""',
  '  $p = $null',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); v=$v }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const arr = JSON.parse(ps(RAW));
const le = Array.isArray(arr) ? arr : [arr];
console.log(`\nQLineEdit с координатами (${le.length}):`);
for (const e of le.filter((x) => x.y > 1200 && x.y < 1500)) {
  console.log(`  [${e.i}] (${e.x},${e.y}) ="${e.v}"`);
}
console.log('\nThreshold после клика =', thr());
