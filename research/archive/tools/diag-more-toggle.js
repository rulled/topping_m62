/**
 * Диагностика: что происходит с панелью при клике MORE?
 *
 * Возможно: MORE переключает (toggle), и если панель открыта — закрывает.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findReverbButtons } from '../ui-control.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hasDry = () => dumpTree().items.some((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');

console.log(`Dry есть (панель открыта): ${hasDry()}`);
console.log(`кнопки реверба: ${JSON.stringify(findReverbButtons())}`);

if (!hasDry()) {
  console.log('\nнажимаю MORE...');
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.Name -eq "MORE") {',
    '    $ip = $null',
    '    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {',
    '      ([System.Windows.Automation.InvokePattern]$ip).Invoke()',
    '      Write-Output ("MORE idx=" + $i)',
    '      break',
    '    }',
    '  }',
    '}',
  ].join('\n');
  try { console.log('  ' + ps(RAW).trim()); } catch { /* */ }
  await sleep(3000);
}

console.log(`\nпосле: Dry есть = ${hasDry()}`);
const btns = findReverbButtons();
console.log(`кнопки реверба: ${JSON.stringify(btns)}`);

if (hasDry() && !btns) {
  // разбираем, что есть в области Decay
  const { items } = dumpTree();
  const decay = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Decay');
  console.log(`\nDecay: ${decay ? `(${decay.lx},${decay.ly})` : 'нет'}`);
  if (decay) {
    const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
      && Math.abs(x.lx - (decay.lx + 37)) < 40
      && x.ly > decay.ly && x.ly < decay.ly + 300)
      .sort((a, b) => a.ly - b.ly);
    console.log(`кнопки в колонке Decay+37: ${col.length}`);
    for (const c of col) console.log(`  [${c.i}] (${c.lx},${c.ly})`);

    // все кнопки в широкой области вокруг
    const wide = items.filter((x) => /QPushButton/.test(x.cls ?? '')
      && Math.abs(x.lx - decay.lx) < 120 && x.ly > decay.ly && x.ly < decay.ly + 350)
      .sort((a, b) => a.ly - b.ly);
    console.log(`\nвсе кнопки в широкой области (${wide.length}):`);
    for (const c of wide) console.log(`  [${c.i}] (${c.lx},${c.ly}) "${(c.name || '').slice(0, 16)}"`);
  }
}
