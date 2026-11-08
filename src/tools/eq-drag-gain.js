/**
 * ИЗМЕНЕНИЕ Gain ПОЛОСЫ 1 перетаскиванием — с замером каждого шага.
 *
 * Безопасность: EQ выключен (Toggle=Off), MUTE HP/OTG = On.
 * Проверяем это ПЕРЕД работой.
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

// ─── ПРОВЕРКА БЕЗОПАСНОСТИ ───
console.log('═══ ПРОВЕРКА БЕЗОПАСНОСТИ ═══');
const { items: safe } = dumpTree();

// EQ IN1
const eqCol = safe.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
  .sort((a, b) => a.ly - b.ly);
const eqBtn = eqCol[5];
const eqState = eqBtn ? toggleState(eqBtn.i) : '?';
console.log(`  EQ IN1: ${eqState}  ${eqState === 'Off' ? '✓ выключен' : '⚠ ВКЛЮЧЕН'}`);

// MUTE выходов
const mutes = safe.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
const muteStates = mutes.map((m) => toggleState(m.i));
console.log(`  MUTE выходов: ${muteStates.join(', ')}  ${muteStates.every((s) => s === 'On') ? '✓ заглушено' : '⚠'}`);

const safeToTest = eqState === 'Off' && muteStates.every((s) => s === 'On');
if (!safeToTest) {
  console.log('\n⚠ СПОРНЫЙ МОМЕНТ: условия безопасности не выполнены — прерываю');
  process.exit(1);
}
console.log('  ✓ безопасно\n');

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return p.length >= 5
    ? { fmt: 'hp', type: p[0], gain: p[1], freq: p[2], q: p[3] }
    : { fmt: 'in', type: p[0], freq: p[1], q: p[2], gain: p[3] };
};

console.log(`Eq%401 до: ${band()}`);
console.log(`  разбор: ${JSON.stringify(parse(band()))}\n`);

// ─── ПЕРЕТАСКИВАНИЕ ───
const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

function drag(lx, ly, dyPx) {
  const px = Math.round(lx / scale);
  const py = Math.round(ly / scale);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MDrag {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MDrag]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 350
[MDrag]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 200
for ($i = 1; $i -le 10; $i++) {
  [MDrag]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / 10) * $i))
  Start-Sleep -Milliseconds 45
}
Start-Sleep -Milliseconds 200
[MDrag]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "dragged"
`;
  return psx(SCRIPT);
}

// Gain dial полосы 1 = (714,564)
const { items: it } = dumpTree();
const gainDial = it.find((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - 714) < 20 && Math.abs(x.ly - 564) < 20);
if (!gainDial) { console.log('Gain dial не найден'); process.exit(1); }
console.log(`Gain dial: [${gainDial.i}] (${gainDial.lx},${gainDial.ly})`);

console.log('\n═══ ШАГ 1: тяну вверх на 40 px ═══');
console.log('  ' + drag(gainDial.lx, gainDial.ly, -40));
await sleep(2000);
const after1 = band();
console.log(`  файл: ${after1}`);
console.log(`  разбор: ${JSON.stringify(parse(after1))}`);
