/**
 * РАЗБОР ЧИСЛОВЫХ ПОЛЕЙ ОКНА EQ: Gain, Freq, Q для каждой полосы.
 *
 * В окне найдены QLineEdit. Нужно понять, какой относится к чему.
 * Строки: Type (y=544), Gain (y=598), Freq (y=676), Q (y=754).
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// окно EQ: x > 1550, y 240..900
const eq = items.filter((x) => x.lx > 1550 && x.ly > 240 && x.ly < 950);

/** Прочитать значение ValuePattern. */
function val(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NP" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

// группируем по строкам (y)
console.log('=== ЭЛЕМЕНТЫ ПО СТРОКАМ (только QLineEdit и ComboBox) ===');
const rows = new Map();
for (const e of eq) {
  if (!/QLineEdit|ComboBox/.test(e.cls ?? '')) continue;
  const key = Math.round(e.ly / 8) * 8;
  if (!rows.has(key)) rows.set(key, []);
  rows.get(key).push(e);
}

for (const [y, els] of [...rows].sort((a, b) => a[0] - b[0])) {
  console.log(`\n  строка y≈${y}:`);
  for (const e of els.sort((a, b) => a.lx - b.lx)) {
    const v = val(e.i);
    console.log(`    [${String(e.i).padStart(3)}] ${e.cls.padEnd(16)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) = "${v}"`);
  }
}

// подписи для ориентира
console.log('\n=== ПОДПИСИ ПАРАМЕТРОВ ===');
for (const l of eq.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).sort((a, b) => a.ly - b.ly)) {
  console.log(`  (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

console.log('\n=== ФАЙЛ (эталон) ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch: ${i.EQ_IN1?.Switch}`);
for (const k of ['Eq%401', 'Eq%402', 'Eq%403', 'Eq%404']) {
  console.log(`  ${k} = ${i.EQ_IN1?.[k]}`);
}
