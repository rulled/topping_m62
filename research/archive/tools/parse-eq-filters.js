/**
 * РАЗБОР ТИПОВ ФИЛЬТРОВ EQ и значений полос.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();

// комбобоксы типов: ComboBoxS1M3 на y=544
const typeCombos = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx);
console.log(`=== КОМБОБОКСЫ ТИПА ФИЛЬТРА (${typeCombos.length}) ===\n`);

for (const c of typeCombos) {
  const VAL = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${c.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const cur = ps(VAL).trim();

  // варианты
  const OPT = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${c.i})`,
    '$ep = $null',
    'if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) {',
    '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    '  Start-Sleep -Milliseconds 800',
    '  $all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '  $n = @()',
    '  for ($k=0; $k -lt $all2.Count; $k++) {',
    '    $e2 = $all2.Item($k)',
    '    if ($e2.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem" -and $e2.Current.Name) { $n += $e2.Current.Name }',
    '  }',
    '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
    '  Write-Output ($n -join " | ")',
    '}',
  ].join('\n');
  const opts = ps(OPT).trim();

  console.log(`  комбобокс [${c.i}] (${c.lx},${c.ly})`);
  console.log(`    текущий: "${cur}"`);
  console.log(`    варианты: ${opts.slice(0, 200)}`);
}

// QLineEdit рядом с каждым комбобоксом — вероятно числовые значения
console.log('\n=== QLineEdit В ОКНЕ EQ (числовые поля) ===');
const edits = items.filter((x) => x.cls === 'QLineEdit' && x.lx > 1600 && x.ly > 350 && x.ly < 900)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const e of edits) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${e.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${String(e.i).padStart(3)}] (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) "${ps(RAW).trim()}"`);
}

console.log('\n=== ФАЙЛ ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch: ${i.EQ_IN1?.Switch}`);
for (const [k, v] of Object.entries(i.EQ_IN1 ?? {})) {
  if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
}
