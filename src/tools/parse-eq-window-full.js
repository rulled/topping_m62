/**
 * РАЗБОР ОКНА EQ — без кликов мышью.
 *
 * Окно уже открыто. Читаем все элементы через UIA.
 * Для изменения значений используем InvokePattern / RangeValuePattern /
 * SendMessage — НЕ трогая курсор.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const { items } = dumpTree();
console.log(`всего элементов: ${items.length}\n`);

const hasEq = items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
console.log(`окно EQ: ${hasEq ? 'ОТКРЫТО' : 'закрыто'}`);
if (!hasEq) process.exit(1);

// окно EQ — правая часть
const eq = items.filter((x) => x.lx > 1500);
console.log(`элементов в окне EQ: ${eq.length}\n`);

/** Прочитать описание элемента: значение/диапазон/toggle. */
function describe(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$out = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  $out += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '}',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  $out += "R=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]"',
    '}',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {',
    '  $out += "T=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState',
    '}',
    'if ($out.Count -eq 0) { Write-Output "-" } else { Write-Output ($out -join " ") }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

// подписи окна EQ
console.log('=== ПОДПИСИ ===');
for (const l of eq.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

// комбобоксы типов
console.log('\n=== КОМБОБОКСЫ ТИПА ===');
for (const c of eq.filter((x) => /ComboBox/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx)) {
  console.log(`  [${String(c.i).padStart(3)}] ${c.cls.padEnd(16)} (${String(c.lx).padStart(4)},${String(c.ly).padStart(4)}) ${describe(c.i)}`);
}

// диалы и слайдеры
console.log('\n=== ДИАЛЫ / СЛАЙДЕРЫ ===');
for (const d of eq.filter((x) => /Dial|QSlider/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  console.log(`  [${String(d.i).padStart(3)}] ${d.cls.padEnd(16)} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)}) ${describe(d.i)}`);
}

// кнопки
console.log('\n=== КНОПКИ ===');
for (const b of eq.filter((x) => /QPushButton|QToolButton/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (b.name || '').slice(0, 20);
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(14)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${describe(b.i)} "${nm}"`);
}

// поля ввода
console.log('\n=== QLineEdit ===');
for (const e of eq.filter((x) => x.cls === 'QLineEdit').sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  console.log(`  [${String(e.i).padStart(3)}] (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) ${describe(e.i)}`);
}

console.log('\n=== ФАЙЛ ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch: ${i.EQ_IN1?.Switch}`);
for (const k of ['Eq%401', 'Eq%402', 'Eq%403', 'Eq%404']) {
  console.log(`  ${k} = ${i.EQ_IN1?.[k]}`);
}
