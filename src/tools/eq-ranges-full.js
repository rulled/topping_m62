/**
 * ИЗМЕРЕНИЕ ДИАПАЗОНОВ EQ: Gain / Freq / Q полосы 1.
 *
 * Безопасность: EQ выключен, MUTE On — проверяется перед работой.
 * Тянем до упора, фиксируем min/max.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

function toggleState(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) { Write-Output ([System.Windows.Automation.TogglePattern]$t).Current.ToggleState } else { Write-Output "NO" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

// ─── БЕЗОПАСНОСТЬ ───
const { items: safe } = dumpTree();
const eqCol = safe.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350).sort((a, b) => a.ly - b.ly);
const eqBtn = eqCol[5];
const eqState = eqBtn ? toggleState(eqBtn.i) : '?';
const mutes = safe.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
const muteStates = mutes.map((m) => toggleState(m.i));

console.log(`EQ IN1: ${eqState}, MUTE: ${muteStates.join('/')}`);
if (eqState !== 'Off' || !muteStates.every((s) => s === 'On')) {
  console.log('⚠ условия безопасности не выполнены — прерываю');
  process.exit(1);
}
console.log('✓ безопасно\n');

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return { fmt: p.length >= 5 ? 'hp' : 'in', type: p[0], gain: Number(p.length >= 5 ? p[1] : p[3]), freq: Number(p.length >= 5 ? p[2] : p[1]), q: Number(p.length >= 5 ? p[3] : p[2]) };
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
public class MD2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MD2]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MD2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 180
for ($i = 1; $i -le 10; $i++) {
  [MD2]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 10) * $i))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 180
[MD2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(SCRIPT);
}

function findDial(lx, ly) {
  const { items } = dumpTree();
  return items.find((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - lx) < 20 && Math.abs(x.ly - ly) < 20) ?? null;
}

// Gain (714,564), Freq (714,642), Q (714,720)
const DIALS = { gain: [714, 564], freq: [714, 642], q: [714, 720] };

for (const [name, [dx, dy]] of Object.entries(DIALS)) {
  const d = findDial(dx, dy);
  if (!d) { console.log(`${name}: диал не найден`); continue; }

  console.log(`═══ ${name.toUpperCase()} (dial ${d.lx},${d.ly}) ═══`);
  console.log(`  старт: ${JSON.stringify(parse(band()))}`);

  // вверх до упора
  let prev = null;
  for (let i = 0; i < 25; i++) {
    drag(d.lx, d.ly, -60);
    await sleep(600);
    const cur = parse(band())[name];
    if (cur === prev) break;
    prev = cur;
  }
  const maxVal = parse(band())[name];
  console.log(`  MAX ${name} = ${maxVal}`);

  // вниз до упора
  prev = null;
  for (let i = 0; i < 30; i++) {
    drag(d.lx, d.ly, 60);
    await sleep(600);
    const cur = parse(band())[name];
    if (cur === prev) break;
    prev = cur;
  }
  const minVal = parse(band())[name];
  console.log(`  MIN ${name} = ${minVal}`);
  console.log(`  ДИАПАЗОН: ${minVal} .. ${maxVal}\n`);
}
