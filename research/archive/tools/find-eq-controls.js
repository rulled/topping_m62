/**
 * ПОИСК EQ-КОНТРОЛОВ: пробуем открыть EQ-панель разными способами.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickAt(lx, ly, cls = 'QPushButton') {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    `  if ($e.Current.ClassName -notmatch "${cls}") { continue }`,
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    `  $d = [Math]::Abs($r.X + $r.Width/2 - ${lx}) + [Math]::Abs($r.Y + $r.Height/2 - ${ly})`,
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 50) { Write-Output "NF"; exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output ("OK" + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

function count() {
  return dumpTree().items.length;
}

console.log(`элементов сейчас: ${count()}\n`);

// ищем все интерактивные элементы возле IN1 (66,980)
console.log('=== элементы возле IN1 (66,980) ===');
const { items } = dumpTree();
const near = items.filter((x) => Math.abs(x.lx - 66) < 120 && x.ly > 940 && x.ly < 1200);
for (const e of near.slice(0, 15)) {
  console.log(`  [${e.i}] ${e.cls} (${e.lx},${e.ly}) "${(e.name || '').slice(0, 20)}"`);
}

console.log('\n=== пробую нажать на IN1 ===');
console.log('  ' + clickAt(66, 980, 'QPushButton|QLabel'));
await sleep(2000);
console.log(`  элементов после: ${count()}`);

console.log('\n=== все кнопки в области входа (x<500, y 900-1250) ===');
const { items: it2 } = dumpTree();
const btns = it2.filter((x) => x.cls === 'QPushButton' && x.lx < 500 && x.ly > 900 && x.ly < 1250);
for (const b of btns) console.log(`  [${b.i}] (${b.lx},${b.ly}) "${(b.name || '').slice(0, 24)}"`);

console.log('\n=== ищу кнопки EQ по всему UI ===');
const eqBtns = it2.filter((x) => x.cls === 'QPushButton' && /eq|EQ/i.test(x.name || ''));
if (eqBtns.length) {
  for (const b of eqBtns) console.log(`  [${b.i}] (${b.lx},${b.ly}) "${b.name}"`);
} else {
  console.log('  кнопок с именем EQ не найдено');
  console.log('\n  все подписи (текст):');
  for (const l of it2.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).slice(0, 45)) {
    console.log(`    [${l.i}] (${String(l.lx).padStart(4)},${l.ly}) "${l.name.slice(0, 26)}"`);
  }
}
