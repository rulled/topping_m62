/**
 * ГДЕ ХРАНИТСЯ EQ Switch?
 *
 * После записи 0 в файл MCC выставил 1. HID-теги 0x9b все = 0.
 * Значит:
 *   - либо MCC хранит в памяти и перезаписывает файл
 *   - либо состояние в другом месте
 *
 * Проверяем UI: подсвечена ли кнопка EQ.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const { items } = dumpTree();

// находим кнопку EQ для IN1 (6-я в колонке Input)
const inputLabel = items.find((x) => (x.name || '').trim() === 'Input');
console.log(`заголовок Input: ${inputLabel ? `(${inputLabel.lx},${inputLabel.ly})` : 'нет'}`);

const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && x.ly > 100 && x.ly < 540 && x.lx < 600)
  .sort((a, b) => a.lx - b.lx || a.ly - b.ly);

// группируем по колонкам
const cols = new Map();
for (const b of btns) {
  const key = Math.round(b.lx / 50) * 50;
  if (!cols.has(key)) cols.set(key, []);
  cols.get(key).push(b);
}

console.log('\nколонки кнопок в области Input:');
for (const [x, list] of [...cols].sort((a, b) => a[0] - b[0])) {
  console.log(`  x≈${x}: ${list.length} кнопок`);
  for (const b of list.sort((a, c) => a.ly - c.ly)) {
    console.log(`    [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)})`);
  }
}

// проверяем ToggleState у кнопки EQ
console.log('\n=== состояние кнопок (Toggle, если есть) ===');
for (const b of btns.slice(0, 14)) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${b.i})`,
    '$t = $null',
    '$out = ""',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) { $out = "TOGGLE=" + ([System.Windows.Automation.TogglePattern]$t).Current.ToggleState }',
    'else { $out = "no-toggle" }',
    'Write-Output $out',
  ].join('\n');
  let st = 'ERR';
  try { st = ps(RAW).trim(); } catch { /* */ }
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${st}`);
}

console.log('\n=== файл ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch = ${i.EQ_IN1?.Switch}`);
