/**
 * ПОИСК кнопок реверба по ВСЕМУ окну в текущей раскладке.
 *
 * Ищем любые интерактивные элементы в области эффектов,
 * которые могут быть переключателями типа реверба.
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// находим заголовок FX-панели и Dry
const dry = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
console.log(`Dry: ${dry ? `(${dry.lx},${dry.ly})` : 'нет'}`);

// ВСЕ интерактивные элементы в области эффектов
// область: от панели FX до правого края
const fxLabel = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'FX');
console.log(`FX label: ${fxLabel ? `(${fxLabel.lx},${fxLabel.ly})` : 'нет'}`);

const area = items.filter((x) => x.lx > 350 && x.lx < 1200 && x.ly > 500 && x.ly < 1000);
console.log(`\nвсе элементы в области эффектов (${area.length}):`);

const byClass = new Map();
for (const e of area) {
  if (!byClass.has(e.cls)) byClass.set(e.cls, []);
  byClass.get(e.cls).push(e);
}

for (const [cls, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${cls} — ${list.length} шт:`);
  for (const e of list.sort((a, b) => a.ly - b.ly || a.lx - b.lx).slice(0, 12)) {
    const nm = (e.name || '').replace(/\n/g, '/').slice(0, 24);
    console.log(`    [${String(e.i).padStart(3)}] (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) "${nm}"`);
  }
}

// ищем кнопки с Toggle в этой области — это могут быть переключатели типа
console.log('\n=== КНОПКИ С TOGGLE В ОБЛАСТИ ЭФФЕКТОВ ===');
const { ps, PRELUDE } = await import('./uia.js');
const toggles = area.filter((x) => /QPushButton|QToolButton|QRadioButton/.test(x.cls ?? ''));
for (const t of toggles) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${t.i})`,
    '$o = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $o += "T=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $o += "SEL" }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $o += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
    'if ($o.Count -eq 0) { Write-Output "" } else { Write-Output ($o -join " ") }',
  ].join('\n');
  let d = '';
  try { d = ps(RAW).trim(); } catch { /* */ }
  if (d) console.log(`  [${String(t.i).padStart(3)}] ${t.cls.padEnd(12)} (${String(t.lx).padStart(4)},${String(t.ly).padStart(4)}) ${d}`);
}
