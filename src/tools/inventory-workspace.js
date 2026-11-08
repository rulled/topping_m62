/**
 * ПОЛНАЯ ИНВЕНТАРИЗАЦИЯ: все ключи и все встречающиеся значения
 * во всех workspace-файлах.
 *
 * Нужно, чтобы бекенд знал полный набор параметров и допустимых значений.
 */
import { listWorkspaces, readWorkspace } from '../workspace.js';

const all = listWorkspaces();
console.log(`workspace-файлов: ${all.length}\n`);

// собираем: section -> key -> Set(значений)
const inv = new Map();
const sources = new Set();
const gains = new Map();

for (const w of all) {
  let ini;
  try { ini = readWorkspace(w.path); } catch (e) {
    console.log(`пропуск ${w.name}: ${e.message}`);
    continue;
  }
  for (const [section, kv] of Object.entries(ini)) {
    if (!inv.has(section)) inv.set(section, new Map());
    const sec = inv.get(section);
    for (const [k, v] of Object.entries(kv)) {
      if (!sec.has(k)) sec.set(k, new Set());
      sec.get(k).add(v);
    }
    if (kv.AudioSource) sources.add(kv.AudioSource);
    if (kv.MIC) sources.add('MIC:' + kv.MIC);
  }
}

console.log('=== СЕКЦИИ И КЛЮЧИ (значения из всех файлов) ===\n');
const sorted = [...inv.keys()].sort();
for (const section of sorted) {
  const sec = inv.get(section);
  console.log(`[${section}]  (${sec.size} ключей)`);
  for (const [k, vals] of [...sec].sort()) {
    const v = [...vals];
    const shown = v.length <= 4 ? v.join(' | ') : `${v.slice(0, 3).join(' | ')} … (${v.length})`;
    console.log(`   ${k} = ${shown}`);
  }
  console.log();
}

console.log('=== ВСЕ ЗНАЧЕНИЯ AudioSource ===');
for (const s of [...sources].filter((x) => !x.startsWith('MIC:')).sort()) {
  console.log(`   "${s}"`);
}
console.log('\n=== ВСЕ ЗНАЧЕНИЯ MIC ===');
for (const s of [...sources].filter((x) => x.startsWith('MIC:')).sort()) {
  console.log(`   "${s.slice(4)}"`);
}
