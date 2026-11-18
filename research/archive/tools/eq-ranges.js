/**
 * EQ: типы фильтров и диапазоны значений.
 *
 * Нужно для фронта: какие бывают типы (peaking/lowpass/...),
 * какие пределы у частоты, Q и gain.
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const ini = () => readWorkspace(findActiveWorkspace().path);

console.log('=== 1. ТЕКУЩИЕ EQ-ПОЛОСЫ ===\n');
const i0 = ini();
for (const sec of ['EQ_IN1', 'EQ_IN2', 'EQ_HP']) {
  if (!i0[sec]) continue;
  console.log(`[${sec}]`);
  for (const [k, v] of Object.entries(i0[sec])) {
    if (/Eq%40|^Eq/.test(k)) console.log(`  ${k} = ${v}`);
  }
  console.log();
}

console.log('=== 2. ВСЕ КЛЮЧИ EQ-СЕКЦИЙ ===\n');
for (const sec of ['EQ_IN1', 'EQ_IN2', 'EQ_HP']) {
  if (!i0[sec]) continue;
  console.log(`[${sec}] ключи: ${Object.keys(i0[sec]).join(', ')}`);
}

console.log('\n=== 3. ЧТО ПИШЕТ MCC ПРИ ИЗМЕНЕНИИ (наблюдение) ===');
console.log('  Формат EQ_IN1/IN2: |тип|частота|Q|gain|');
console.log('  Формат EQ_HP:      тип|gain|частота|Q|флаг');
console.log('');
console.log('  примеры из файла:');
for (const sec of ['EQ_IN1', 'EQ_HP']) {
  const kv = i0[sec];
  if (!kv) continue;
  for (const [k, v] of Object.entries(kv)) {
    if (/^Eq%40/.test(k)) console.log(`    ${sec}.${k} = "${v}"`);
  }
}
