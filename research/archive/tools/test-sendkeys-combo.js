/**
 * ПОСЛЕДНЯЯ ПОПЫТКА БЕЗ МЫШИ: SetFocus + SendKeys на комбобокс.
 *
 * SendKeys НЕ двигает курсор — шлёт в фокусное окно.
 * Нужно только активировать окно MCC (SetForegroundWindow — не двигает курсор).
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch (err) {
    const out = String(err.stdout ?? '') + String(err.stderr ?? '');
    const first = out.split(/\r?\n/).find((l) => l.trim() && !l.includes('at line')) ?? err.message;
    return `ERR: ${String(first).trim().slice(0, 120)}`;
  }
};

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

function comboVal(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value } else { Write-Output "NP" }',
  ].join('\n');
  return psx(RAW);
}

const { items } = dumpTree();
const combo = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)[0];
if (!combo) { console.log('комбобокс не найден'); process.exit(1); }

console.log(`комбобокс [${combo.i}], значение "${comboVal(combo.i)}"`);
console.log(`файл до: ${band()}\n`);

// активируем окно (курсор не двигается) + SetFocus на комбобокс + стрелка вниз
const S = PRELUDE + [
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -TypeDefinition @\'',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class Fg {',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '}',
  '\'@',
  '$root = Get-MccRoot',
  '$hwnd = [IntPtr]$root.Current.NativeWindowHandle',
  '[Fg]::SetForegroundWindow($hwnd) | Out-Null',
  'Start-Sleep -Milliseconds 500',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$c = $all.Item(${combo.i})`,
  'try { $c.SetFocus() } catch { }',
  'Start-Sleep -Milliseconds 400',
  // читаем значение ДО
  '$p = $null',
  'if ($c.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
  '  Write-Output ("before=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value)',
  '}',
  // открываем список и жмём вниз
  '[System.Windows.Forms.SendKeys]::SendWait("{F4}")',
  'Start-Sleep -Milliseconds 600',
  '[System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
  'Start-Sleep -Milliseconds 300',
  '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  'Start-Sleep -Milliseconds 800',
  // читаем ПОСЛЕ
  '$p2 = $null',
  'if ($c.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p2)) {',
  '  Write-Output ("after=" + ([System.Windows.Automation.ValuePattern]$p2).Current.Value)',
  '}',
].join('\n');

console.log(psx(S));
await sleep(2000);

const { items: it2 } = dumpTree();
const c2 = it2.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)[0];
console.log(`\nзначение после: "${c2 ? comboVal(c2.i) : '?'}"`);
console.log(`файл после: ${band()}`);
