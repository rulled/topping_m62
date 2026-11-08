/** Найти переключатель workspace в UI MCC. */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

console.log('=== ComboBox ===');
for (const x of items.filter((i) => /ComboBox/.test(i.cls))) {
  console.log(`  [${String(x.i).padStart(3)}] ${x.cls.padEnd(16)} (${x.lx},${x.ly}) "${(x.name || '').replace(/\n/g, '/')}" [${x.pats}]`);
}

console.log('\n=== подпись Workspace и рядом ===');
const ws = items.find((x) => (x.name || '').trim() === 'Workspace');
if (ws) {
  console.log(`  подпись: [${ws.i}] (${ws.lx},${ws.ly})`);
  const near = items.filter((x) => Math.abs(x.ly - ws.ly) < 40 && x.i !== ws.i);
  for (const n of near) {
    console.log(`    -> [${String(n.i).padStart(3)}] ${n.cls.padEnd(16)} (${n.lx},${n.ly}) "${(n.name || '').replace(/\n/g, '/')}" [${n.pats}]`);
  }
}

console.log('\n=== все QLineEdit в верхней полосе (y<130) ===');
for (const x of items.filter((i) => i.cls === 'QLineEdit' && i.ly < 130)) {
  console.log(`  [${String(x.i).padStart(3)}] (${x.lx},${x.ly}) "${(x.name || '').replace(/\n/g, '/')}"`);
}
