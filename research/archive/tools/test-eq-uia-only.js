/**
 * СМЕНА ТИПА ФИЛЬТРА ЧЕРЕЗ UIA БЕЗ МЫШИ.
 *
 * Пробуем три подхода, все без движения курсора:
 *   1) SelectionItemPattern.Select() на пункте списка
 *   2) ExpandCollapsePattern + SendKeys (SendKeys не двигает курсор)
 *   3) ValuePattern.SetValue — уже знаем, что не работает, но проверим
 *
 * SendKeys безопасен: он шлёт сообщения в фокусное окно, курсор не трогает.
 * НО требует, чтобы окно MCC было активным — переключим фокус программно.
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
    return `ERR: ${String(first).trim().slice(0, 140)}`;
  }
};

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

const { items } = dumpTree();
const hasEq = items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`окно EQ: ${hasEq ? 'открыто' : 'закрыто'}`);
if (!hasEq) process.exit(1);

const combo = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)[0];
console.log(`комбобокс типа полосы 1: [${combo.i}] (${combo.lx},${combo.ly})\n`);
console.log(`Eq%401 до: ${band()}\n`);

// ── способ 1: найти пункты списка через UIA и Select() ──
console.log('=== способ 1: ExpandCollapse + SelectionItem.Select ===');
const S1 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$combo = $all.Item(${combo.i})`,
  '$ep = $null',
  'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 0 }',
  '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
  'Start-Sleep -Milliseconds 900',
  // ищем пункты ВНУТРИ комбобокса (а не глобально)
  '$items = $combo.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'Write-Output ("внутри combo найдено: " + $items.Count)',
  'for ($k = 0; $k -lt $items.Count; $k++) {',
  '  $it = $items.Item($k)',
  '  Write-Output ("  [" + $k + "] " + $it.Current.ControlType.ProgrammaticName + " name=" + $it.Current.Name + " class=" + $it.Current.ClassName)',
  '}',
  '([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
].join('\n');
console.log(psx(S1));

// ── способ 2: SendKeys (не двигает курсор) ──
console.log('\n=== способ 2: SendKeys по элементу ===');
const S2 = PRELUDE + [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$combo = $all.Item(${combo.i})`,
  // SetFocus через UIA — не двигает курсор
  'try { $combo.SetFocus(); Write-Output "focus set" } catch { Write-Output ("focus err: " + $_.Exception.Message) }',
  'Start-Sleep -Milliseconds 400',
  'try {',
  '  [System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
  '  Start-Sleep -Milliseconds 250',
  '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
  '  Start-Sleep -Milliseconds 250',
  '  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  '  Write-Output "keys sent"',
  '} catch { Write-Output ("keys err: " + $_.Exception.Message) }',
].join('\n');
console.log(psx(S2));
await sleep(2500);
console.log(`\nEq%401 после: ${band()}`);

