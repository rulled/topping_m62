/**
 * ПОИСК КНОПКИ EQ РЯДОМ С IN1/IN2 (координаты сдвинулись).
 *
 * IN1 на (850,584), IN2 на (888,584).
 * Кнопка EQ должна быть рядом — возможно, чуть ниже или выше.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`всего элементов: ${items.length}\n`);

const IN1 = { x: 850, y: 584 };
const IN2 = { x: 888, y: 584 };

// область вокруг IN1/IN2: ±150 по x, -60..+320 по y
const area = items.filter((x) =>
  x.lx >= IN1.x - 160 && x.lx <= IN1.x + 260
  && x.ly >= IN1.y - 80 && x.ly <= IN1.y + 340);

console.log(`=== ЭЛЕМЕНТЫ ВОЗЛЕ IN1/IN2 (${area.length}) ===`);
for (const e of area.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 28);
  const pats = Array.isArray(e.pats) ? e.pats.join(',') : String(e.pats ?? '');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(20)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) [${pats}] "${nm}"`);
}

// ВСЕ кнопки в этой области
console.log('\n=== ВСЕ КНОПКИ В ОБЛАСТИ ВХОДОВ ===');
const btns = items.filter((x) => /QPushButton|QToolButton/.test(x.cls ?? '')
  && x.lx >= IN1.x - 200 && x.lx <= IN1.x + 400
  && x.ly >= IN1.y - 100 && x.ly <= IN1.y + 400)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const b of btns) {
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(14)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 26)}"`);
}

// все классы элементов в области — чтобы понять структуру
console.log('\n=== КЛАССЫ ЭЛЕМЕНТОВ В ОБЛАСТИ (уникальные) ===');
const classes = [...new Set(area.map((x) => x.cls))];
for (const c of classes) {
  const cnt = area.filter((x) => x.cls === c).length;
  console.log(`  ${c.padEnd(24)} ${cnt}`);
}
