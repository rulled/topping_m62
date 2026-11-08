/**
 * ВСЕ элементы в области значений окна EQ (y 580..800).
 *
 * Подписи Gain (1684,598), Freq (1684,676), Q (1684,754) есть,
 * а QLineEdit там нет. Значит поля другого класса.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// область значений: x 1600..2100, y 580..820
const area = items.filter((x) => x.lx > 1600 && x.lx < 2100 && x.ly > 580 && x.ly < 820);
console.log(`=== ВСЕ ЭЛЕМЕНТЫ В ОБЛАСТИ ЗНАЧЕНИЙ (${area.length}) ===`);
for (const e of area.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 26);
  const pats = Array.isArray(e.pats) ? e.pats.join(',') : String(e.pats ?? '');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(22)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) [${pats.padEnd(6)}] "${nm}"`);
}

// уникальные классы
console.log('\n=== КЛАССЫ В ОБЛАСТИ ===');
const cls = new Map();
for (const e of area) cls.set(e.cls, (cls.get(e.cls) ?? 0) + 1);
for (const [c, n] of cls) console.log(`  ${c.padEnd(24)} ${n}`);

// пробуем прочитать значения у всех, у кого есть Value или RangeValue
console.log('\n=== ЗНАЧЕНИЯ (Value / RangeValue) ===');
for (const e of area.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  if (!/QLineEdit|QSpinBox|QDoubleSpinBox|QAbstractSpinBox|Dial|QSlider/.test(e.cls ?? '')) continue;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${e.i})`,
    '$v = $null',
    '$r = $null',
    '$out = ""',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$v)) { $out += "V=" + ([System.Windows.Automation.ValuePattern]$v).Current.Value }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$r)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$r',
    '  $out += " R=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]"',
    '}',
    'if ($out -eq "") { $out = "нет паттернов" }',
    'Write-Output $out',
  ].join('\n');
  let v = 'ERR';
  try { v = ps(RAW).trim(); } catch { /* */ }
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(20)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) ${v}`);
}
