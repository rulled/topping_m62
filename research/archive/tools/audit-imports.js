/**
 * АУДИТ ui-control.js: все ли используемые функции импортированы?
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('src/ui-control.js', 'utf8');

// что импортировано
const importLines = src.split('\n').filter((l) => l.trim().startsWith('import '));
console.log('=== ИМПОРТЫ ===');
for (const l of importLines) console.log('  ' + l.trim());

// какие идентификаторы используются как функции
const used = new Set();
const re = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
let m;
while ((m = re.exec(src)) !== null) used.add(m[1]);

// известные встроенные / определённые в файле
const defined = new Set();
const reDef = /(?:function|const|let)\s+([a-zA-Z_$][\w$]*)/g;
while ((m = reDef.exec(src)) !== null) defined.add(m[1]);

const imported = new Set();
const reImp = /import\s*\{([^}]+)\}/g;
while ((m = reImp.exec(src)) !== null) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) imported.add(name);
  }
}

const builtins = new Set([
  'Number', 'String', 'Math', 'JSON', 'Boolean', 'Array', 'Object', 'Error',
  'Promise', 'Set', 'Map', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'require', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'console',
]);

console.log('\n=== ПОДОЗРИТЕЛЬНЫЕ: используются, но не определены/не импортированы ===');
let suspicious = 0;
for (const u of [...used].sort()) {
  if (defined.has(u) || imported.has(u) || builtins.has(u)) continue;
  // отфильтруем методы (вызовы вида obj.method() уже не попадут как имя)
  console.log(`  ${u}`);
  suspicious++;
}
if (suspicious === 0) console.log('  нет — всё определено');

console.log('\n=== ДИАГНОСТИКА ===');
console.log(`  определено в файле: ${defined.size}`);
console.log(`  импортировано: ${imported.size}`);
console.log(`  используется как функция: ${used.size}`);

// проверим конкретно dumpTree
console.log(`\n  dumpTree: используется=${used.has('dumpTree')} импортирован=${imported.has('dumpTree')} определен=${defined.has('dumpTree')}`);
