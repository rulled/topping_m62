/**
 * РАЗБОР ПАНЕЛИ "User presets" в MCC.
 *
 * Она на (2758,1208). Смотрим, какие кнопки/элементы рядом
 * и что они делают.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { items } = dumpTree();
console.log(`всего элементов: ${items.length}\n`);

// область User presets: x 2600..3400, y 1150..1650
const area = items.filter((x) => x.lx > 2600 && x.lx < 3450 && x.ly > 1150 && x.ly < 1680);
console.log(`=== ЭЛЕМЕНТЫ В ОБЛАСТИ "User presets" (${area.length}) ===`);
for (const e of area.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 30);
  const pats = Array.isArray(e.pats) ? e.pats.join(',') : String(e.pats ?? '');
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(18)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) [${pats}] "${nm}"`);
}

// также посмотрим область Scene (2758,984)
console.log(`\n=== ЭЛЕМЕНТЫ В ОБЛАСТИ "Scene" (x>2600, y 940..1180) ===`);
const scene = items.filter((x) => x.lx > 2600 && x.ly > 940 && x.ly < 1180);
for (const e of scene.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 30);
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(18)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) "${nm}"`);
}

// все кнопки с цифрами или словами preset/save/load
console.log('\n=== КНОПКИ С "preset" В ИМЕНИ ===');
const named = items.filter((x) => /preset|save|load|Preset|Save|Load/i.test(x.name || ''));
if (named.length) {
  for (const n of named) console.log(`  [${n.i}] ${n.cls} (${n.lx},${n.ly}) "${n.name}"`);
} else {
  console.log('  не найдено — кнопки без имён, работают по координатам');
}

console.log('\n=== ТЕКУЩЕЕ СОСТОЯНИЕ ===');
const w = findActiveWorkspace();
const i = readWorkspace(w.path);
console.log(`  workspace: ${w.mode}/${w.name}`);
console.log(`  Compressor.Threshold: ${i.Compressor?.Threshold}`);
