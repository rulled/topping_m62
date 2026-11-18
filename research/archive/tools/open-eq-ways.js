/**
 * ОТКРЫТИЕ ОКНА EQ — разные способы.
 *
 * Двойной клик мышью не сработал. Пробуем:
 *   1) InvokePattern на кнопке
 *   2) двойной клик с бОльшей паузой
 *   3) двойной клик через SetCursorPos + отдельные события
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// найти кнопку EQ
const { items } = dumpTree();
const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && x.lx > 100 && x.lx < 145 && x.ly > 100 && x.ly < 340)
  .sort((a, b) => a.ly - b.ly);
const eqBtn = col[5];
console.log(`кнопка EQ: [${eqBtn?.i}] (${eqBtn?.lx},${eqBtn?.ly})`);
if (!eqBtn) process.exit(1);

const hasEq = () => dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));

// способ 1: InvokePattern
console.log('\n--- способ 1: InvokePattern ---');
const INV = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$e = $all.Item(${eqBtn.i})`,
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "invoked"',
  '} else { Write-Output "no invoke" }',
].join('\n');
console.log('  ' + psx(INV));
await sleep(3000);
console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);

if (!hasEq()) {
  // способ 2: двойной клик с паузой 400 мс
  console.log('\n--- способ 2: двойной клик (пауза 400мс) ---');
  const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  const scale = Number(scaleRaw) || 1.75;
  const px = Math.round(eqBtn.lx / scale);
  const py = Math.round(eqBtn.ly / scale);

  const DBL2 = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSE4 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSE4]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 500
[MSE4]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MSE4]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 400
[MSE4]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MSE4]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "dbl2"
`;
  console.log('  ' + psx(DBL2));
  await sleep(3500);
  console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);
}

if (!hasEq()) {
  // способ 3: правый клик / контекстное меню
  console.log('\n--- способ 3: проверяю, есть ли QMenu после клика ---');
  const MENU = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$n = @()',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -match "QMenu|QComboBoxPrivateContainer") { $n += ($e.Current.ClassName + ":" + $e.Current.Name) }',
    '}',
    'Write-Output ($n -join "; ")',
  ].join('\n');
  console.log('  меню: ' + (psx(MENU) || 'нет'));
}

console.log('\nитог: окно EQ', hasEq() ? 'ОТКРЫТО' : 'закрыто');
