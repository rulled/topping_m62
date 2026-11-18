/**
 * СМЕНА ТИПА через SelectionItemPattern.Select() — БЕЗ МЫШИ.
 *
 * Нашли: внутри комбобокса есть ListItem'ы (peaking, lowpass, ...).
 * Пробуем Select() на них.
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

function findCombo() {
  const { items } = dumpTree();
  const c = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)[0];
  return c ?? null;
}

const combo = findCombo();
if (!combo) { console.log('комбобокс не найден'); process.exit(1); }
console.log(`комбобокс: [${combo.i}] (${combo.lx},${combo.ly})`);
console.log(`Eq%401 до: ${band()}\n`);

/** Выбрать пункт списка по имени — без мыши. */
function selectByItemName(comboIdx, itemName) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${comboIdx})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 0 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 900',
    '$items = $combo.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$done = $false',
    'for ($k = 0; $k -lt $items.Count; $k++) {',
    '  $it = $items.Item($k)',
    `  if ($it.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem" -and $it.Current.Name -eq '${itemName}') {`,
    '    $sp = $null',
    '    if ($it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) {',
    '      try {',
    '        ([System.Windows.Automation.SelectionItemPattern]$sp).Select()',
    '        Write-Output ("SELECT_OK " + $it.Current.Name)',
    '        $done = $true',
    '      } catch { Write-Output ("SELECT_ERR: " + $_.Exception.Message) }',
    '    } else { Write-Output "NO_SELECTION_ITEM_PATTERN" }',
    '    break',
    '  }',
    '}',
    'if (-not $done) { Write-Output "NOT_FOUND_OR_FAILED" }',
    'try { ([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse() } catch { }',
  ].join('\n');
  return psx(RAW);
}

const TYPES = ['lowpass', 'highpass', 'lowshelf', 'highshelf', 'peaking'];

for (const t of TYPES) {
  const c = findCombo();
  if (!c) { console.log('комбобокс пропал'); break; }
  const r = selectByItemName(c.i, t);
  await sleep(2200);
  const bandNow = band();
  const parts = String(bandNow).split('|').filter((x) => x !== '');
  console.log(`${t.padEnd(10)} -> ${r.padEnd(20)} файл тип=${parts[0]}  (${bandNow})`);
  if (r.includes('SELECT_ERR') || r.includes('NOT_FOUND')) break;
}

console.log(`\nитог Eq%401: ${band()}`);
