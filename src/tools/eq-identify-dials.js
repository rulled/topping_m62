/**
 * ОПРЕДЕЛЕНИЕ ДИАЛА FREQ — какой из них какой.
 *
 * Три ряда диалов в окне EQ: y=564 (Gain), y=642 (Freq), y=720 (Q).
 * Проверяем каждый на полосе 1, но БЕЗ риска:
 *   - EQ выключен
 *   - MUTE включён
 *
 * Каждый dial слегка двигаем и смотрим, что меняется в файле.
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

// ═══ БЕЗОПАСНОСТЬ ═══
console.log('═══ ПРОВЕРКА БЕЗОПАСНОСТИ ═══');
let { items } = dumpTree();

const eqCol = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350).sort((a, b) => a.ly - b.ly);
const eqBtn = eqCol[5];
const eqState = eqBtn ? toggleState(eqBtn.i) : '?';

const mutes = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
const muteStates = mutes.map((m) => toggleState(m.i));

console.log(`  EQ IN1: ${eqState}`);
console.log(`  MUTE: ${muteStates.join('/')}`);

if (eqState !== 'Off' || !muteStates.every((s) => s === 'On')) {
  console.log('\n⚠ НЕ БЕЗОПАСНО — ставлю защиту...');
  if (mutes.length) {
    for (const m of mutes) {
      const st = toggleState(m.i);
      if (st !== 'On') {
        const RAW = PRELUDE + [
          '$root = Get-MccRoot',
          '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
          `$e = $all.Item(${m.i})`, '$t = $null',
          'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) { ([System.Windows.Automation.TogglePattern]$t).Toggle() }',
        ].join('\n');
        psx(RAW);
        await sleep(600);
      }
    }
    await sleep(1500);
    ({ items } = dumpTree());
    const m2 = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
    console.log(`  MUTE теперь: ${m2.map((m) => toggleState(m.i)).join('/')}`);
  }
}
console.log('');

// ═══ ОТКРЫТЬ ОКНО EQ ═══
if (!items.some((x) => /EqualizerPanel/.test(x.cls ?? ''))) {
  console.log('открываю окно EQ...');
  const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  const scale = Number(scaleRaw) || 1.75;
  const px = Math.round((eqBtn?.lx ?? 122) / scale);
  const py = Math.round((eqBtn?.ly ?? 270) / scale);
  const S = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MO1 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MO1]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 400
[MO1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MO1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 120
[MO1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MO1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(S);
  await sleep(3500);
  ({ items } = dumpTree());
}

const hasEq = items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`окно EQ: ${hasEq ? 'ОТКРЫТО' : 'закрыто'}\n`);
if (!hasEq) process.exit(1);

// ═══ ЗАМЕР: какой dial что меняет ═══
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
public class MD4 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MD4]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MD4]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 150
for ($i = 1; $i -le 8; $i++) {
  [MD4]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 8) * $i))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 150
[MD4]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(SCRIPT);
}

console.log(`старт: ${JSON.stringify(parse(band()))}\n`);

// три ряда полосы 1
const ROWS = [
  { name: 'ряд y=564', y: 564 },
  { name: 'ряд y=642', y: 642 },
  { name: 'ряд y=720', y: 720 },
];

for (const row of ROWS) {
  const { items: it } = dumpTree();
  const d = it.find((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - 714) < 25 && Math.abs(x.ly - row.y) < 25);
  if (!d) { console.log(`${row.name}: диал не найден`); continue; }

  const before = parse(band());
  drag(d.lx, d.ly, -30);
  await sleep(1500);
  const after = parse(band());

  const changes = [];
  for (const k of ['gain', 'freq', 'q', 'type']) {
    if (String(before[k]) !== String(after[k])) changes.push(`${k}: ${before[k]} -> ${after[k]}`);
  }
  console.log(`${row.name} (${d.lx},${d.ly}): ${changes.length ? changes.join(', ') : 'нет изменений'}`);
}

console.log(`\nитог: ${JSON.stringify(parse(band()))}`);
console.log(`raw: ${band()}`);
