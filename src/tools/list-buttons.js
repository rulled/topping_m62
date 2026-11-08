/** Список всех кнопок с координатами и паттернами. */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
const btns = items.filter((x) => x.cls === 'QPushButton' && /[IT]/.test(x.pats));
console.log(`всего кнопок: ${btns.length}\n`);
for (const x of btns) {
  const nm = (x.name || '').replace(/\n/g, '/');
  console.log(`[${String(x.i).padStart(3)}] (${String(x.lx).padStart(4)},${String(x.ly).padStart(4)}) ${String(x.w).padStart(3)}x${String(x.h).padStart(3)} [${x.pats}] "${nm}"`);
}
