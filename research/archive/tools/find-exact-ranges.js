/**
 * ТОЧНЫЕ ДИАПАЗОНЫ: входы, выходы, микшер, loopback.
 *
 * Валидация резала Input_IN1.GAIN=20 как "вне -90..12" — это баг.
 * Входы имеют другой диапазон. Читаем из UI RangeValue.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from './../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// все слайдеры с диапазонами
const sliders = items.filter((x) => x.cls === 'QSlider');
console.log(`слайдеров: ${sliders.length}`);
for (const s of sliders) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${s.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${String(s.i).padStart(3)}] (${String(s.lx).padStart(4)},${String(s.ly).padStart(4)}) ${ps(RAW).trim()}`);
}

// все dial'ы — у них нет RangeValue, но проверим
console.log('\nдиал\'ы (у Dial обычно нет RangeValue):');
const dials = items.filter((x) => /Dial/.test(x.cls ?? ''));
for (const d of dials) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${d.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${String(d.i).padStart(3)}] (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)}) ${d.cls.padEnd(10)} ${ps(RAW).trim()}`);
}

// подписи рядом с входами (для определения шкал)
console.log('\nподписи в области входов (y 1600-1700):');
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim() && x.ly > 1600 && x.ly < 1700);
for (const l of labels.sort((a, b) => a.lx - b.lx)) {
  console.log(`  (${String(l.lx).padStart(4)},${l.ly}) "${l.name}"`);
}

console.log('\n=== ФАЙЛ (эталон значений) ===');
const w = findActiveWorkspace();
const i = readWorkspace(w.path);
console.log('  inputs:', ['IN1', 'IN2', 'AUX', 'BT', 'OTGIN'].map((n) => `${n}=${i[`Input_${n}`]?.GAIN}`).join(' '));
