/**
 * Найти ЧИСЛОВЫЕ ПОДПИСИ рядом с диалами EQ.
 *
 * DialS1M5 не имеет ValuePattern, но рядом MCC рисует QLabel
 * с текущим значением (как "-18" и "0" у компрессора).
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
const panel = items.find((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`панель EQ: ${panel ? `(${panel.lx},${panel.ly})` : 'нет'}`);

// все QLabel с числами в области EQ
const numLabels = items.filter((x) => x.cls === 'QLabel' && x.name && /^[-+\d∞.]+$/.test(x.name.trim()))
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);

console.log(`\nчисловых подписей всего: ${numLabels.length}`);
for (const l of numLabels) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

// все подписи в области окна EQ (x 600..1100)
console.log('\nвсе подписи в области EQ (x 600..1100, y 450..800):');
const eqLabels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()
  && x.lx > 600 && x.lx < 1100 && x.ly > 450 && x.ly < 800)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const l of eqLabels) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name}"`);
}

// диалы — для сопоставления
console.log('\nдиалы EQ:');
const dials = items.filter((x) => /Dial/.test(x.cls ?? '') && x.lx > 650 && x.lx < 1050 && x.ly > 450 && x.ly < 800)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const d of dials) {
  console.log(`  [${String(d.i).padStart(3)}] ${d.cls.padEnd(12)} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)})`);
}
