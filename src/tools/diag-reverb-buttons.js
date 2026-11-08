/**
 * Диагностика кнопок реверба: где они сейчас и есть ли у них имена.
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// все кнопки с именами
const named = items.filter((x) => /QToolButton|QPushButton/.test(x.cls ?? '') && x.name && x.name.trim());
console.log(`=== КНОПКИ С ИМЕНАМИ (${named.length}) ===`);
for (const b of named.sort((a, c) => a.ly - c.ly || a.lx - c.lx)) {
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(14)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${b.name}"`);
}

// кнопки в вероятной области реверба
console.log('\n=== КНОПКИ В ОБЛАСТИ РЕВЕРБА (x 900..1200, y 1400..1750) ===');
const rev = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && x.lx > 900 && x.lx < 1200 && x.ly > 1400 && x.ly < 1750)
  .sort((a, b) => a.ly - b.ly);
console.log(`  найдено: ${rev.length}`);
for (const b of rev) {
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 22)}"`);
}

// подписи Reverb / Dry / Wet
console.log('\n=== ПОДПИСИ, СВЯЗАННЫЕ С РЕВЕРБОМ ===');
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && /dry|wet|room|decay|width|reverb/i.test(x.name));
for (const l of labels) console.log(`  (${l.lx},${l.ly}) "${l.name}"`);

// все подписи для ориентира
console.log('\n=== ВСЕ ПОДПИСИ (первые 40) ===');
const all = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const l of all.slice(0, 40)) console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.slice(0, 26)}"`);
