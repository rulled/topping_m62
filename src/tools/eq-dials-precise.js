/**
 * ТОЧНОЕ определение диалов полосы 1.
 *
 * Обнаружено: (714,564) меняет всё сразу — вероятно, это интерактивная
 * точка на графике (EqWidgetIem), а не dial.
 * (714,642) = Freq. (714,720) = Q — не сработал.
 *
 * Проверяем каждый по отдельности с откатом.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
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

// безопасность
let { items } = dumpTree();
const mutes = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
console.log(`MUTE: ${mutes.map((m) => toggleState(m.i)).join('/')}`);
if (!mutes.every((m) => toggleState(m.i) === 'On')) {
  console.log('⚠ MUTE не стоит — прерываю');
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
public class MD5 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MD5]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MD5]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 150
for ($i = 1; $i -le 8; $i++) {
  [MD5]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 8) * $i))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 150
[MD5]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(SCRIPT);
}

// найдём ВСЕ диалы полосы 1 (x≈714)
const { items: it } = dumpTree();
const colDials = it.filter((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - 714) < 30)
  .sort((a, b) => a.ly - b.ly);
console.log('диалы колонки 1:');
for (const d of colDials) console.log(`  [${d.i}] ${d.cls} (${d.lx},${d.ly})`);

console.log(`\nстарт: ${JSON.stringify(parse(band()))}\n`);

// проверяем каждый
for (const d of colDials) {
  const before = parse(band());
  drag(d.lx, d.ly, -25);
  await sleep(1400);
  const after = parse(band());
  const changes = [];
  for (const k of ['gain', 'freq', 'q']) {
    if (String(before[k]) !== String(after[k])) changes.push(`${k} ${before[k]}->${after[k]}`);
  }
  console.log(`  (${d.lx},${d.ly}) ${d.cls}: ${changes.length ? changes.join(', ') : '—'}`);
}

console.log(`\nитог raw: ${band()}`);
