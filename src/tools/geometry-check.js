/**
 * ГЕОМЕТРИЯ ОКНА MCC — под текущее разрешение.
 *
 * ВАЖНО: разрешение и DPI МЕНЯЮТСЯ (RDP-сессия отдаёт 1920x1080 DPI 96,
 * локально было 2560x1080 DPI 168). Все координаты в eq-control.js и
 * ui-control.js сняты при 2560x1080 — при смене разрешения их надо
 * ПЕРЕПРОВЕРЯТЬ.
 *
 * Этот инструмент печатает:
 *   - текущий масштаб и геометрию окна
 *   - координаты именованных кнопок (они НЕ зависят от разрешения)
 *   - реальные координаты EQ-элементов
 *
 * Запуск: node src/tools/geometry-check.js
 */
import { dumpTree } from './uia.js';

const { scale, items } = dumpTree();
console.log(`масштаб UIA: ${scale}`);
console.log(`элементов в дереве: ${items.length}`);

const win = items.find((x) => x.cls === 'MainWindow_M62');
if (win) {
  console.log(`окно MCC: ${win.w}x${win.h} @ (${win.lx},${win.ly})`);
} else {
  // dumpTree обходит DESCENDANTS, а корень (само окно MainWindow_M62) в них
  // не попадает. Поэтому берём максимальный прямоугольник из первых
  // элементов — это и есть окно.
  const biggest = [...items].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (biggest) {
    console.log(`окно MCC (корень, оценка по max-элементу): ${biggest.w}x${biggest.h} @ (${biggest.lx},${biggest.ly})`);
  } else {
    console.log('окно MCC: элементов нет вообще');
  }
}

console.log('\n=== ИМЕНОВАННЫЕ КНОПКИ (разрешение-независимые) ===');
const named = items.filter((x) => x.name && (
  /^(Load preset1|Load preset2|Save preset1|Save preset2|Chat|Vocal|MORE)$/.test(x.name)
));
for (const n of named.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  console.log(`  "${n.name}" (${n.lx},${n.ly}) cls=${n.cls} pats=${n.pats}`);
}

console.log('\n=== EQ-ЭЛЕМЕНТЫ (координаты зависят от разрешения) ===');
const eqWin = items.find((x) => x.cls === 'EqualizerBase');
if (!eqWin) {
  console.log('  окно EQ не открыто');
} else {
  console.log(`  окно EQ: ${eqWin.w}x${eqWin.h} @ (${eqWin.lx},${eqWin.ly})`);

  const combos = items.filter((x) => x.cls === 'ComboBoxS1M3').sort((a, b) => a.lx - b.lx);
  console.log(`  комбобоксы типов (${combos.length}):`);
  for (const c of combos) console.log(`     (${c.lx},${c.ly})`);

  const dials = items.filter((x) => x.cls === 'DialS1M5'
    && /EqWidgetIem/.test(x.name ?? '') === false && x.ly > 520 && x.ly < 780 && x.lx > 700);
  console.log(`  дилы (${dials.length}):`);
  const rows = {};
  for (const d of dials) (rows[d.ly] ??= []).push(d.lx);
  for (const [y, xs] of Object.entries(rows).sort((a, b) => a[0] - b[0])) {
    console.log(`     y=${y}: x=${[...new Set(xs)].sort((a, b) => a - b).join(', ')}`);
  }
}

console.log('\n=== ПРОВЕРКА СОВПАДЕНИЯ С КОНСТАНТАМИ eq-control.js ===');
const EXPECTED = { bands: [714, 796, 878, 960], rows: { type: 508, gain: 564, freq: 642, q: 720 } };
const combos = items.filter((x) => x.cls === 'ComboBoxS1M3').sort((a, b) => a.lx - b.lx);
if (combos.length === 4) {
  const actualX = combos.map((c) => c.lx);
  console.log(`  комбобоксы ожидались x≈${EXPECTED.bands.join(',')}`);
  console.log(`  реально             x=${actualX.join(',')}`);
  console.log(`  y ожидался ${EXPECTED.rows.type}, реально ${combos[0].ly}`);
}
