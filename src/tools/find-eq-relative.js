/**
 * Надёжный поиск кнопки EQ — ОТНОСИТЕЛЬНО заголовка "Input".
 *
 * Не хардкодим координаты: находим "Input", затем кнопки под ним,
 * берём 6-ю в самой левой колонке.
 */
import { dumpTree } from './uia.js';

/** Найти кнопку EQ для IN1. */
export function findEqButton(which = 'IN1') {
  const { items } = dumpTree();

  const inputLabel = items.find((x) => (x.name || '').trim() === 'Input');
  if (!inputLabel) return { error: 'заголовок "Input" не найден', items };

  // кнопки под заголовком Input, левее панели Mixer
  const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.ly > inputLabel.ly + 20
    && x.ly < inputLabel.ly + 460
    && x.lx > inputLabel.lx - 60
    && x.lx < inputLabel.lx + 620)
    .sort((a, b) => a.lx - b.lx || a.ly - b.ly);

  // группируем по колонкам (x с шагом ~150)
  const cols = [];
  for (const b of btns) {
    let col = cols.find((c) => Math.abs(c.x - b.lx) < 25);
    if (!col) { col = { x: b.lx, items: [] }; cols.push(col); }
    col.items.push(b);
  }
  cols.sort((a, b) => a.x - b.x);
  for (const c of cols) c.items.sort((a, b) => a.ly - b.ly);

  // Колонки входов содержат по 7 кнопок (48V/AUTO/.../DUCKING).
  // Отбрасываем колонки с 2 кнопками — это SOLO/MUTE.
  const inputCols = cols.filter((c) => c.items.length >= 5);

  const colIndex = which === 'IN2' ? 1 : 0;
  const target = inputCols[colIndex];
  if (!target) {
    return {
      error: `колонка ${which} не найдена`,
      cols: cols.map((c) => ({ x: c.x, count: c.items.length })),
    };
  }

  return {
    button: target.items[5] ?? null,   // EQ = 6-я сверху = индекс 5
    column: target,
    colIndex,
    inputLabel,
    allCols: cols.map((c) => ({ x: c.x, count: c.items.length })),
  };
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const which = process.argv[2] ?? 'IN1';
  const r = findEqButton(which);
  if (r.error) {
    console.log(`ERROR: ${r.error}`);
    if (r.cols) for (const c of r.cols) console.log(`  колонка x=${c.x}: ${c.items.length} кнопок`);
    process.exit(1);
  }
  console.log(`заголовок Input: (${r.inputLabel.lx},${r.inputLabel.ly})`);
  console.log(`колонки: ${r.allCols.map((c) => `x=${c.x}(${c.count})`).join(', ')}`);
  console.log(`\nколонка ${which} (x=${r.column.x}):`);
  r.column.items.forEach((b, i) => {
    console.log(`  ${i}: [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${i === 5 ? '<-- EQ' : ''}`);
  });
  console.log(`\nкнопка EQ: ${r.button ? `[${r.button.i}] (${r.button.lx},${r.button.ly})` : 'НЕ НАЙДЕНА'}`);
}
