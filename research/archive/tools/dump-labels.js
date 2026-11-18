/** Дамп ВСЕХ подписей в открытой панели настроек. */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`всего элементов: ${items.length}\n`);

const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
console.log(`подписей с текстом: ${labels.length}\n`);

// отсортировать по Y, показать все
labels.sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const l of labels) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.replace(/\n/g, '/')}"`);
}
