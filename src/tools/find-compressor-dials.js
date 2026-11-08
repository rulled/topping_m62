/**
 * Найти правильные dial'ы компрессора.
 * Тянем каждый и смотрим, какой параметр меняется.
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

function dragPx(x, y, dyPx, s) {
  const px = Math.round(x / s);
  const py = Math.round(y / s);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSF {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSF]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 250
[MSF]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 150
for ($i=1; $i -le 10; $i++) {
  [MSF]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 10) * $i))
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 150
[MSF]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

const s = scale();
console.log(`DPI scale = ${s}\n`);

// получаем все dial'ы
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
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
const dials = (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.y - b.y || a.x - b.x);

console.log('=== ПЕРЕБОР DIAL\'ОВ (тянем +30px) ===\n');
const before0 = comp();
console.log('исходное:', JSON.stringify(before0), '\n');

const found = [];
for (const d of dials) {
  const b = comp();
  dragPx(d.x, d.y, 30, s);
  await sleep(1500);
  const a = comp();

  const diffs = Object.keys(a).filter((k) => a[k] !== b[k] && Number.isFinite(a[k]) && Number.isFinite(b[k]));
  const desc = diffs.length
    ? diffs.map((k) => `${k}: ${b[k]} -> ${a[k]}`).join(', ')
    : '—';
  console.log(`[${String(d.i).padStart(3)}] (${String(d.x).padStart(4)},${String(d.y).padStart(4)}) ${desc}`);
  if (diffs.length) found.push({ dial: d, params: diffs });

  // возвращаем обратно
  if (diffs.length) {
    dragPx(d.x, d.y, -30, s);
    await sleep(1200);
  }
}

console.log('\n=== НАЙДЕННЫЕ СООТВЕТСТВИЯ ===');
for (const f of found) {
  console.log(`  (${f.dial.x},${f.dial.y}) -> ${f.params.join(', ')}`);
}

console.log('\nитоговое состояние:', JSON.stringify(comp()));
