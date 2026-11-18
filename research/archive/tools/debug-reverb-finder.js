/**
 * Почему findReverbButtons возвращает null, хотя кнопки есть?
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
const dry = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
const decay = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Decay');

console.log(`Dry: ${dry ? `(${dry.lx},${dry.ly})` : 'НЕТ'}`);
console.log(`Decay: ${decay ? `(${decay.lx},${decay.ly})` : 'НЕТ'}`);

if (decay) {
  const targetX = decay.lx + 37;
  console.log(`\nцелевой x = ${targetX} (Decay.x + 37)`);

  const all = items.filter((x) => /QPushButton/.test(x.cls ?? ''));
  console.log(`всего QPushButton: ${all.length}`);

  // проверяем фильтр по X
  const byX = all.filter((x) => Math.abs(x.lx - targetX) < 25);
  console.log(`\nкнопок с |lx - ${targetX}| < 25: ${byX.length}`);
  for (const b of byX.sort((a, c) => a.ly - c.ly)) {
    console.log(`  [${b.i}] (${b.lx},${b.ly})  в диапазоне y? ${b.ly > decay.ly + 40 && b.ly < decay.ly + 250}`);
  }

  // проверяем полный фильтр
  const col = byX.filter((x) => x.ly > decay.ly + 40 && x.ly < decay.ly + 250).sort((a, b) => a.ly - b.ly);
  console.log(`\nпосле фильтра по y (${decay.ly + 40} .. ${decay.ly + 250}): ${col.length}`);
  for (const c of col) console.log(`  [${c.i}] (${c.lx},${c.ly})`);
}
