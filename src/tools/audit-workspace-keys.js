/**
 * ВАЛИДАЦИЯ ВСЕХ КЛЮЧЕЙ WORKSPACE против validateWorkspaceValue.
 *
 * Ищем ключи, которые реальный файл содержит, но валидатор не знает
 * или отвергает. Это дырки: либо валидатор строже реальности, либо
 * ключ новый и его надо добавить.
 *
 * Запуск: node src/tools/audit-workspace-keys.js
 */
import { readWorkspace, findActiveWorkspace } from '../workspace.js';
import { validateWorkspaceValue } from '../workspace-service.js';

const ws = readWorkspace(findActiveWorkspace().path);
console.log('файл:', findActiveWorkspace().path);

let total = 0;
let known = 0;
const rejected = [];

for (const [section, kv] of Object.entries(ws)) {
  if (typeof kv !== 'object' || kv === null) continue;
  for (const [key, value] of Object.entries(kv)) {
    total++;
    try {
      validateWorkspaceValue(section, key, value);
      // валидатор пропустил; проверим, покрыт ли ключ вообще правилом
      known++;
    } catch (e) {
      rejected.push({ section, key, value, error: e.message });
    }
  }
}

console.log(`\nвсего ключей: ${total}`);
console.log(`прошли валидацию: ${known}`);
console.log(`ОТВЕРГНУТЫ: ${rejected.length}`);

if (rejected.length) {
  console.log('\n=== ОТВЕРГНУТЫЕ КЛЮЧИ ===');
  for (const r of rejected) {
    console.log(`  ${r.section}.${r.key} = ${JSON.stringify(r.value)}`);
    console.log(`     ${r.error}`);
  }
}

// Покрытие: какие ключи не имеют ЯВНОГО правила (валидатор их молча пропускает)
console.log('\n=== КЛЮЧИ БЕЗ ЯВНОГО ПРАВИЛА (проходят «на автомате») ===');
const COVERED = [
  /^(48V|MUTE|SOLO|Link|MUTE(Left|Right)|SOLO(Left|Right))$/,
  /^(Switch|DuckingSwitch)$/,
  /^Mix[A-H]_GAIN$/,
  /^GAIN$/,
  /^GAIN(Left|Right)$/,
  /^(Input\dLevel|AuxLevel|BluetoothLevel|OtgLevel)$/,
  /^NoiseReduction(NC1|NC2|Bypass)$/,
  /^(Reverb|DryWet|Decay)(Studio|Live|Hall|Bypass)$/,
  /^Width(Studio|Live|Hall|Bypass)$/,
  /^(Threshold|Ratio|Attack|Release|Mix|Reduction)$/,
  /^Eq%40\d+$/,
  /^(GainInput|GainOutput)$/,
];
const uncovered = [];
for (const [section, kv] of Object.entries(ws)) {
  if (typeof kv !== 'object' || kv === null) continue;
  for (const [key, value] of Object.entries(kv)) {
    if (!COVERED.some((re) => re.test(key))) {
      uncovered.push({ section, key, value });
    }
  }
}
console.log(`ключей без правила: ${uncovered.length}`);
const bySection = {};
for (const u of uncovered) (bySection[u.section] ??= []).push(`${u.key}=${u.value}`);
for (const [s, list] of Object.entries(bySection)) {
  console.log(`  ${s} (${list.length}): ${list.join(', ')}`);
}
