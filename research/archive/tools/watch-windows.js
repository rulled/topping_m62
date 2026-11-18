/**
 * ЧТО ПОЯВЛЯЕТСЯ ПРИ КЛИКЕ ПО EQ — поиск ЛЮБОГО нового окна.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * Три способа клика по кнопке EQ наушников (i=40) не открыли окно
 * с классом EqualizerBase. При этом раньше в этом же режиме окно
 * БЫЛО открыто (мы видели EqWidgetIem: 10, ComboBoxS1M3: 10).
 *
 * Значит либо окно открывается в другом месте дерева, либо клик
 * не доходит, либо окно называется иначе.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Снимает список ВСЕХ окон процесса MCC (верхний уровень).
 * 2. Кликает по EQ.
 * 3. Снимает список снова.
 * 4. Показывает разницу — какое окно появилось.
 *
 * Запуск: node src/tools/watch-windows.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Все окна верхнего уровня, принадлежащие MCC. */
function listWindows() {
  const body = [
    '$procs = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue',
    'if (-not $procs) { Write-Output "NO_PROC"; exit 0 }',
    '$mccPids = @($procs | ForEach-Object { $_.Id })',
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    '$c = [System.Windows.Automation.Condition]::TrueCondition',
    '$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $c)',
    'for ($i = 0; $i -lt $wins.Count; $i++) {',
    '  $w = $wins.Item($i)',
    '  $ownerPid = $w.Current.ProcessId',
    '  if ($mccPids -notcontains $ownerPid) { continue }',
    '  $r = $w.Current.BoundingRectangle',
    '  Write-Output ("W|" + $i + "|" + $w.Current.ClassName + "|" + $w.Current.Name + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + [int]$r.Width + "|" + [int]$r.Height)',
    '}',
  ].join('\n');

  const out = ui(body);
  if (!out || out === 'NO_PROC') return [];
  return out
    .split('\n')
    .filter((l) => l.startsWith('W|'))
    .map((l) => {
      const [, i, cls, name, x, y, w, h] = l.split('|');
      return { i: Number(i), cls, name, x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    });
}

/** Клик по элементу через Invoke + фокус + Enter + двойной клик. */
function activate(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    '$r = $e.Current.BoundingRectangle',
    '$cx = [int]($r.X + $r.Width / 2)',
    '$cy = [int]($r.Y + $r.Height / 2)',
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class WClk {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    '\'@ -ErrorAction SilentlyContinue',
    '[WClk]::SetCursorPos($cx, $cy)',
    'Start-Sleep -Milliseconds 400',
    '[WClk]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[WClk]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 100',
    '[WClk]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[WClk]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Write-Output ("CLICKED " + $cx + "," + $cy)',
  ].join('\n');
  return ui(body);
}

async function main() {
  console.log('=== окна MCC ДО клика ===');
  const before = listWindows();
  for (const w of before) {
    console.log(`  ${w.cls.padEnd(24)} (${w.x},${w.y}) ${w.w}x${w.h}  name=[${w.name}]`);
  }

  console.log('\n=== клик по EQ наушников (i=40) ===');
  console.log(`  ${activate(40)}`);
  await sleep(3000);

  console.log('\n=== окна MCC ПОСЛЕ клика ===');
  const after = listWindows();
  for (const w of after) {
    console.log(`  ${w.cls.padEnd(24)} (${w.x},${w.y}) ${w.w}x${w.h}  name=[${w.name}]`);
  }

  console.log('\n=== разница ===');
  const beforeKeys = new Set(before.map((w) => `${w.cls}|${w.x},${w.y}`));
  const newOnes = after.filter((w) => !beforeKeys.has(`${w.cls}|${w.x},${w.y}`));
  if (!newOnes.length) {
    console.log('  новых окон НЕТ');
    console.log('\n  Возможно, EQ наушников открывается иначе (например,');
    console.log('  вкладкой внутри окна, или требует включённого Switch).');
  } else {
    for (const w of newOnes) {
      console.log(`  НОВОЕ: ${w.cls} (${w.x},${w.y}) ${w.w}x${w.h} name=[${w.name}]`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
