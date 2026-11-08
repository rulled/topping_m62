/**
 * ПРОВЕРКА: изменилось ли значение в КОМБОБОКСЕ после Select()?
 *
 * Файл может не обновляться (MCC держит в памяти).
 * Смотрим на ValuePattern комбобокса и на подпись типа.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

/** Прочитать ValuePattern комбобокса. */
function comboVal(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NP" }',
  ].join('\n');
  return psx(RAW);
}

function findCombo() {
  const { items } = dumpTree();
  return items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)[0] ?? null;
}

const c = findCombo();
if (!c) { console.log('комбобокс не найден'); process.exit(1); }

console.log(`комбобокс: [${c.i}]`);
console.log(`текущее значение: "${comboVal(c.i)}"`);
console.log(`файл Eq%401: ${readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401']}\n`);

// выбираем highshelf и сразу читаем комбобокс
console.log('=== выбираю highshelf и читаю комбобокс сразу ===');
const S1 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$combo = $all.Item(${c.i})`,
  '$ep = $null',
  '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
  'Start-Sleep -Milliseconds 900',
  '$items = $combo.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'for ($k = 0; $k -lt $items.Count; $k++) {',
  '  $it = $items.Item($k)',
  '  if ($it.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem" -and $it.Current.Name -eq "highshelf") {',
  '    $sp = $null',
  '    if ($it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) {',
  '      ([System.Windows.Automation.SelectionItemPattern]$sp).Select()',
  '    }',
  '  }',
  '}',
  'try { ([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse() } catch { }',
  'Start-Sleep -Milliseconds 600',
  '$p = $null',
  'if ($combo.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
  '  Write-Output ("after=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value)',
  '}',
].join('\n');
console.log(psx(S1));

await sleep(2500);
const c2 = findCombo();
console.log(`\nкомбобокс после (новый индекс [${c2?.i}]): "${c2 ? comboVal(c2.i) : '?'}"`);
console.log(`файл: ${readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401']}`);
