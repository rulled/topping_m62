/**
 * ПРОВЕРКА ФАКТИЧЕСКОГО СОСТОЯНИЯ MUTE через UI.
 *
 * Кнопки MUTE у Output имеют TogglePattern — читаем их состояние.
 * Это безопасно: только чтение.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

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

// подписи Output / HP / OTG
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && /^(Output|HP|OTG|OUT)/i.test(x.name.trim()))
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
console.log('=== ПОДПИСИ ВЫХОДОВ ===');
for (const l of labels) console.log(`  (${l.lx},${l.ly}) "${l.name}"`);

// все кнопки в области Output (правее x>1300)
console.log('\n=== КНОПКИ В ОБЛАСТИ OUTPUT ===');
const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300)
  .sort((a, b) => a.lx - b.lx || a.ly - b.ly);
for (const b of btns) {
  const t = toggleState(b.i);
  const nm = (b.name || '').slice(0, 18);
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${t.padEnd(8)} "${nm}"`);
}

// ключевой вопрос: включён ли EQ IN1?
console.log('\n=== EQ-КНОПКИ ВХОДОВ ===');
const eqCol = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
  .sort((a, b) => a.ly - b.ly);
eqCol.forEach((b, i) => {
  const t = toggleState(b.i);
  console.log(`  ${i}: [${String(b.i).padStart(3)}] (${b.lx},${b.ly}) ${t}${i === 5 ? '  <-- EQ IN1' : ''}`);
});
