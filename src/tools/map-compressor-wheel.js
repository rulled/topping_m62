/**
 * Полный перебор колесом: много прокруток на каждом dial.
 * Цель — найти Ratio, Attack, Release, Mix.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return {
    thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack),
    rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix),
  };
};

const scale = () => {
  try { return Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.')) || 1.75; } catch { return 1.75; }
};
const S = scale();

function wheel(x, y, notches) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSW3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSW3]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${notches}; $i++) {
  [MSW3]::mouse_event(0x0800, 0, 0, 120, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -notmatch "Dial") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2) }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const arr = JSON.parse(ps(RAW));
const dials = Array.isArray(arr) ? arr : [arr];

console.log('исходное:', JSON.stringify(comp()), '\n');

const hits = new Map(); // параметр -> dial

for (const d of dials) {
  const b = comp();
  wheel(d.x, d.y, 10);
  await sleep(1500);
  const a = comp();
  const diffs = Object.keys(a).filter((k) => a[k] !== b[k]);
  if (diffs.length) {
    console.log(`[${String(d.i).padStart(3)}] (${String(d.x).padStart(4)},${String(d.y).padStart(4)}) ${diffs.map((k) => `${k}: ${b[k]}->${a[k]}`).join(', ')}`);
    for (const k of diffs) if (!hits.has(k)) hits.set(k, d);
  }
}

console.log('\n=== СООТВЕТСТВИЕ (колесо) ===');
for (const k of ['thr', 'ratio', 'att', 'rel', 'gain', 'mix']) {
  const d = hits.get(k);
  console.log(`  ${k.padEnd(6)} ${d ? `(${d.x},${d.y})` : 'НЕ НАЙДЕН'}`);
}

console.log('\nитог:', JSON.stringify(comp()));
