/**
 * ТОЧНЫЙ ПОИСК КНОПКИ EQ по TogglePattern + проверке состояния.
 *
 * Кнопки EQ имеют TogglePattern (найдено §94).
 * Ищем ту, чей ToggleState соответствует EQ_IN1.Switch.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();

// колонка IN1 в области Input
const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && x.lx > 100 && x.lx < 145 && x.ly > 100 && x.ly < 340)
  .sort((a, b) => a.ly - b.ly);

console.log(`кнопок в колонке IN1: ${col.length}\n`);

function toggleState(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '  Write-Output ([System.Windows.Automation.TogglePattern]$t).Current.ToggleState',
    '} else { Write-Output "NO_TOGGLE" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

console.log('состояния кнопок:');
for (const b of col) {
  const st = toggleState(b.i);
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${st}`);
}

// EQ — 6-я сверху (индекс 5 в списке)
console.log(`\nвсего ${col.length} кнопок, EQ должна быть 6-й сверху:`);
if (col[5]) {
  console.log(`  [${col[5].i}] (${col[5].lx},${col[5].ly}) — кандидат EQ`);
}
