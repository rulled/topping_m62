/**
 * Найти IN1 и кнопки под ним (координаты после перезапуска MCC).
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
console.log('подписи (первые 20):');
for (const l of labels.sort((a, b) => a.ly - b.ly).slice(0, 20)) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

const in1 = items.find((x) => (x.name || '').trim() === 'IN1');
console.log(`\nIN1: ${in1 ? `[${in1.i}] (${in1.lx},${in1.ly})` : 'НЕ НАЙДЕН'}`);

if (in1) {
  // все кнопки в радиусе
  const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && Math.abs(x.lx - in1.lx) < 30
    && x.ly > in1.ly - 50 && x.ly < in1.ly + 500)
    .sort((a, b) => a.ly - b.ly);
  console.log(`\nкнопки под IN1 (x≈${in1.lx}):`);
  for (const b of btns) {
    console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 20)}"`);
  }

  // что за элементы в колонке IN1 ниже
  console.log(`\nвсе элементы в колонке IN1 (x ${in1.lx - 40}..${in1.lx + 40}, y ${in1.ly}..${in1.ly + 500}):`);
  const col = items.filter((x) => x.lx > in1.lx - 40 && x.lx < in1.lx + 40
    && x.ly > in1.ly && x.ly < in1.ly + 500)
    .sort((a, b) => a.ly - b.ly);
  for (const c of col) {
    console.log(`  [${String(c.i).padStart(3)}] ${c.cls.padEnd(20)} (${String(c.lx).padStart(4)},${String(c.ly).padStart(4)})`);
  }
}
