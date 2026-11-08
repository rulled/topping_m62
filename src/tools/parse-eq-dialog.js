/**
 * ПОЛНЫЙ РАЗБОР ОКНА EQ.
 *
 * Найдено: заголовок "EQ", полосы 1-4, параметры Type/Gain/Freq/Q,
 * секции INPUT и OUTPUT.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// ВСЕ элементы окна EQ (x > 1500)
const eqWin = items.filter((x) => x.lx > 1500);
console.log(`=== ОКНО EQ (${eqWin.length} элементов) ===`);
for (const e of eqWin.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 30);
  const pats = Array.isArray(e.pats) ? e.pats.join(',') : String(e.pats ?? '');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(22)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) [${pats.padEnd(5)}] "${nm}"`);
}

// комбобоксы — это типы фильтров
console.log('\n=== КОМБОБОКСЫ (тип фильтра?) ===');
const combos = eqWin.filter((x) => /ComboBox/.test(x.cls ?? ''));
for (const c of combos) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${c.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  console.log(`  [${c.i}] (${c.lx},${c.ly}) value="${ps(RAW).trim()}"`);

  // читаем варианты
  const OPT = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${c.i})`,
    '$ep = $null',
    'if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) {',
    '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    '  Start-Sleep -Milliseconds 700',
    '  $all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '  $n = @()',
    '  for ($k=0; $k -lt $all2.Count; $k++) {',
    '    $e2 = $all2.Item($k)',
    '    if ($e2.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem" -and $e2.Current.Name) { $n += $e2.Current.Name }',
    '  }',
    '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
    '  Write-Output ($n -join ", ")',
    '}',
  ].join('\n');
  console.log(`       варианты: ${ps(OPT).trim().slice(0, 150)}`);
}

// слайдеры/диалы — Gain/Freq/Q
console.log('\n=== СЛАЙДЕРЫ И ДИАЛЫ (Gain/Freq/Q) ===');
for (const e of eqWin.filter((x) => /QSlider|Dial/.test(x.cls ?? ''))) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${e.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(14)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) ${ps(RAW).trim()}`);
}

// QLineEdit — числовые поля
console.log('\n=== QLineEdit (числовые поля) ===');
for (const e of eqWin.filter((x) => x.cls === 'QLineEdit')) {
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

console.log('\n=== ФАЙЛ (эталон) ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  Switch: ${i.EQ_IN1?.Switch}`);
for (const [k, v] of Object.entries(i.EQ_IN1 ?? {})) {
  if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
}
