/**
 * ОТКРЫТЬ ОКНО EQ через TogglePattern и разобрать паттерны диалов.
 *
 * Защита: EQ Off, MUTE On — проверено.
 * Цель: понять, можно ли менять Gain/Freq/Q без мыши.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hasEq = () => dumpTree().items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));

// находим кнопку EQ IN1 и жмём Invoke (открывает/закрывает)
function findEqBtn() {
  const { items } = dumpTree();
  return items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
    .sort((a, b) => a.ly - b.ly)[5] ?? null;
}

console.log(`окно EQ до: ${hasEq() ? 'открыто' : 'закрыто'}`);

if (!hasEq()) {
  const eq = findEqBtn();
  if (!eq) { console.log('кнопка EQ не найдена'); process.exit(1); }
  console.log(`открываю двойным кликом по [${eq.i}] (${eq.lx},${eq.ly})`);

  // двойной клик через мышь (разрешено, защита стоит)
  const { execFileSync } = await import('node:child_process');
  const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  const scale = Number(scaleRaw) || 1.75;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSF1 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSF1]::SetCursorPos([int](${eq.lx} / ${scale}), [int](${eq.ly} / ${scale}))
Start-Sleep -Milliseconds 300
for ($k = 0; $k -lt 2; $k++) {
  [MSF1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [MSF1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 150
}
`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' }); } catch { /* */ }
  await sleep(3500);
}

console.log(`окно EQ после: ${hasEq() ? 'ОТКРЫТО' : 'закрыто'}`);
if (!hasEq()) { console.log('не удалось открыть'); process.exit(1); }

// разбираем паттерны всех элементов окна EQ
const { items } = dumpTree();
const panel = items.find((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`\nпанель EQ: (${panel.lx},${panel.ly})`);

const inEq = items.filter((x) => Math.abs(x.lx - panel.lx) < 250 && Math.abs(x.ly - panel.ly) < 250);
console.log(`элементов в окне EQ: ${inEq.length}\n`);

console.log('=== ПАТТЕРНЫ ЭЛЕМЕНТОВ ОКНА EQ ===');
for (const e of inEq.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  if (!/Dial|ComboBox|QPushButton|QToolButton|QSlider|QLineEdit/.test(e.cls ?? '')) continue;

  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${e.i})`,
    '$names = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $rv=[System.Windows.Automation.RangeValuePattern]$p; $names += ("RANGE=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "] step=" + $rv.Current.SmallChange) }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $names += ("VALUE=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value) }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $names += ("TOGGLE=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState) }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $names += "INVOKE" }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $names += "SELECTITEM" }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $names += "EXPAND" }',
    'if ($names.Count -eq 0) { Write-Output "нет паттернов" } else { Write-Output ($names -join " ") }',
  ].join('\n');

  let pats = 'ERR';
  try { pats = ps(RAW).trim(); } catch { /* */ }
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(16)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) ${pats}`);
}
