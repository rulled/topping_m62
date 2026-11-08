/**
 * FREQ: диапазон вниз от текущего значения.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return { fmt: p.length >= 5 ? 'hp' : 'in', type: p[0], gain: p[1], freq: Number(p.length >= 5 ? p[2] : p[1]), q: p.length >= 5 ? p[3] : p[2] };
};

const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

function drag(lx, ly, dyPx) {
  const px = Math.round(lx / scale);
  const py = Math.round(ly / scale);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MD3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MD3]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MD3]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 180
for ($i = 1; $i -le 10; $i++) {
  [MD3]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 10) * $i))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 180
[MD3]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(SCRIPT);
}

console.log(`старт: ${band()}`);
console.log(`  freq = ${parse(band()).freq}\n`);

// Freq dial = (714,642)
console.log('=== тяну ВНИЗ до упора ===');
let prev = null;
for (let i = 0; i < 40; i++) {
  drag(714, 642, 60);
  await sleep(500);
  const cur = parse(band()).freq;
  if (cur === prev) { console.log(`  упёрлись: ${cur}`); break; }
  prev = cur;
  if (i % 5 === 0) console.log(`  ${cur}`);
}
const minF = parse(band()).freq;
console.log(`\nMIN freq = ${minF}`);

console.log('\n=== тяну ВВЕРХ до упора ===');
prev = null;
for (let i = 0; i < 40; i++) {
  drag(714, 642, -60);
  await sleep(500);
  const cur = parse(band()).freq;
  if (cur === prev) { console.log(`  упёрлись: ${cur}`); break; }
  prev = cur;
  if (i % 5 === 0) console.log(`  ${cur}`);
}
const maxF = parse(band()).freq;
console.log(`\nДИАПАЗОН FREQ: ${minF} .. ${maxF} Гц`);

// ставим обратно ~632
console.log('\n=== возвращаю ~632 ===');
for (let i = 0; i < 60; i++) {
  const cur = parse(band()).freq;
  if (Math.abs(cur - 632) < 60) { console.log(`  достигли ${cur}`); break; }
  drag(714, 642, cur > 632 ? 20 : -20);
  await sleep(400);
}
console.log(`  итог: ${band()}`);
