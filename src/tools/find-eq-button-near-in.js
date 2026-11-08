/**
 * ПОИСК КНОПКИ EQ РЯДОМ С IN1/IN2.
 *
 * Подсказка пользователя: кнопка EQ находится рядом с IN1/IN2,
 * один клик = вкл/выкл, двойной клик = открыть окно настроек.
 *
 * IN1 подпись на (66,980), IN2 на (130,980) — ищем рядом.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`всего элементов: ${items.length}\n`);

// все элементы в области входов IN1/IN2: x 0..450, y 900..1350
const area = items.filter((x) => x.lx >= 0 && x.lx < 480 && x.ly > 900 && x.ly < 1350);
console.log(`=== ЭЛЕМЕНТЫ ВОЗЛЕ IN1/IN2 (${area.length}) ===`);
for (const e of area.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 28);
  const pats = Array.isArray(e.pats) ? e.pats.join(',') : String(e.pats ?? '');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(18)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) [${pats}] "${nm}"`);
}

// ищем всё, что содержит "eq" в имени
console.log('\n=== ЭЛЕМЕНТЫ С "EQ" В ИМЕНИ ===');
const eqNamed = items.filter((x) => /eq/i.test(x.name || ''));
if (eqNamed.length) {
  for (const e of eqNamed) {
    console.log(`  [${e.i}] ${e.cls} (${e.lx},${e.ly}) "${e.name}"`);
  }
} else {
  console.log('  нет (кнопки без имён)');
}

// все кнопки в области входов (шире: x<600)
console.log('\n=== ВСЕ КНОПКИ x<600, y 900..1400 ===');
const btns = items.filter((x) => (x.cls === 'QPushButton' || x.cls === 'QToolButton')
  && x.lx < 600 && x.ly > 900 && x.ly < 1400)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const b of btns) {
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(14)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 26)}"`);
}
