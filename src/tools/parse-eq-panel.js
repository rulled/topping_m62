/**
 * РАЗБОР ОКНА EQ — через поиск контейнера EqualizerBase/EqualizerPanel
 * и его потомков.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const { items } = dumpTree();

// находим корень EQ
const base = items.find((x) => /EqualizerBase/.test(x.cls ?? ''));
const panel = items.find((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`EqualizerBase: ${base ? `[${base.i}] (${base.lx},${base.ly})` : 'нет'}`);
console.log(`EqualizerPanel: ${panel ? `[${panel.i}] (${panel.lx},${panel.ly})` : 'нет'}`);

// все Equalizer-элементы
const eqCls = items.filter((x) => /Equalizer/.test(x.cls ?? ''));
console.log(`\nвсе Equalizer-элементы (${eqCls.length}):`);
for (const e of eqCls) console.log(`  [${e.i}] ${e.cls} (${e.lx},${e.ly})`);

// EqWidgetIem — точки на графике
const pts = items.filter((x) => /EqWidgetIem/.test(x.cls ?? ''));
console.log(`\nEqWidgetIem (${pts.length}):`);
for (const p of pts.sort((a, b) => a.lx - b.lx)) console.log(`  [${p.i}] (${p.lx},${p.ly})`);

// определяем границы окна EQ по EqualizerPanel
if (!panel) { console.log('\nпанель EQ не найдена'); process.exit(1); }

// окно EQ: берём диапазон вокруг панели
// панель на (1865,566) в прошлый раз; найдём все элементы в её окрестности
const R = 900;
const area = items.filter((x) => x.lx > panel.lx - R && x.lx < panel.lx + R
  && x.ly > panel.ly - 400 && x.ly < panel.ly + 500);

console.log(`\nэлементов вокруг панели: ${area.length}`);

/** Описание элемента. */
function describe(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$out = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $out += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $rv = [System.Windows.Automation.RangeValuePattern]$p; $out += "R=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]" }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $out += "T=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState }',
    'if ($out.Count -eq 0) { Write-Output "-" } else { Write-Output ($out -join " ") }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

// интересующие классы
console.log('\n=== КОМБОБОКСЫ ТИПА (ComboBoxS1M3) ===');
const typeCombos = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx);
for (const c of typeCombos) console.log(`  [${c.i}] (${c.lx},${c.ly}) ${describe(c.i)}`);

console.log('\n=== ДИАЛЫ В ОКНЕ EQ ===');
const dials = items.filter((x) => /Dial/.test(x.cls ?? '') && x.lx > panel.lx - 400)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
const rows = new Map();
for (const d of dials) {
  const k = Math.round(d.ly / 15) * 15;
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k).push(d);
}
for (const [y, list] of [...rows].sort((a, b) => a[0] - b[0])) {
  console.log(`  y≈${y}: x = ${list.map((d) => d.lx).join(', ')}`);
}

console.log('\n=== ПОДПИСИ В ОКНЕ EQ ===');
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()
  && x.lx > panel.lx - 400 && x.ly > 400 && x.ly < 900)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const l of labels) console.log(`  [${l.i}] (${l.lx},${l.ly}) "${l.name}"`);

console.log('\n=== ФАЙЛ ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch: ${i.EQ_IN1?.Switch}`);
for (const k of ['Eq%401', 'Eq%402', 'Eq%403', 'Eq%404']) console.log(`  ${k} = ${i.EQ_IN1?.[k]}`);
