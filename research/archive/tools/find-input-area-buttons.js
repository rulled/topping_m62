/**
 * Найти кнопку EQ в области INPUT (y 76..530), а не FX.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// область Input: y 70..530
const area = items.filter((x) => x.ly > 60 && x.ly < 540 && x.lx < 600);
console.log(`=== ОБЛАСТЬ INPUT (${area.length} элементов) ===`);

const labels = area.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
console.log('\nподписи:');
for (const l of labels.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

console.log('\nкнопки:');
const btns = area.filter((x) => /QPushButton|QToolButton/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const b of btns) {
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(14)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 22)}"`);
}

// IN1 в этой области
const in1 = area.find((x) => (x.name || '').trim() === 'IN1');
console.log(`\nIN1 в области Input: ${in1 ? `[${in1.i}] (${in1.lx},${in1.ly})` : 'нет'}`);

if (in1) {
  const col = area.filter((x) => Math.abs(x.lx - in1.lx) < 40 && x.ly > in1.ly)
    .sort((a, b) => a.ly - b.ly);
  console.log(`элементы ниже IN1:`);
  for (const c of col) {
    console.log(`  [${String(c.i).padStart(3)}] ${c.cls.padEnd(20)} (${String(c.lx).padStart(4)},${String(c.ly).padStart(4)}) "${(c.name || '').slice(0, 18)}"`);
  }
}
