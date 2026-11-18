/**
 * РАЗБОР ДАННЫХ ЛОГГЕРА.
 *
 * В логе зафиксировано изменение: x1119: 0 -> 1, 0x1118: 99 -> 93.
 * Плюс полный дамп EQ-тегов (0x91-0x94, 0x9b).
 */
import { readFileSync } from 'node:fs';

const log = readFileSync('research/settings-log.txt', 'utf8');
const lines = log.split('\n');

console.log('=== ВСЕ СОБЫТИЯ ИЗМЕНЕНИЙ ===\n');
for (const l of lines) {
  if (l.includes('ИЗМЕНЕНИЕ НАСТРОЕК')) console.log(l);
}

console.log('\n=== ЧТО ТАКОЕ 0x1119? ===');
console.log('  В логе: 0x1119 менялся 0 -> 1');
console.log('  Рядом менялся 0x1118 (99 -> 93)');
console.log('  Гипотеза: 0x1118 и 0x1119 — пара (счётчик/флаг)');

console.log('\n=== РАСШИФРОВКА EQ-ТЕГОВ ИЗ ДАМПА ===');
// ищем последний большой дамп
const dumps = lines.filter((l) => l.includes('ДАМП'));
if (dumps.length) {
  const last = dumps[dumps.length - 1];
  const m = last.match(/\{.*\}/);
  if (m) {
    const obj = JSON.parse(m[0]);
    console.log(`  всего тегов в дампе: ${Object.keys(obj).length}`);

    // группируем по семействам
    const fams = new Map();
    for (const [k, v] of Object.entries(obj)) {
      const tt = parseInt(k.split(':')[0].replace('0x', ''), 16);
      if (!fams.has(tt)) fams.set(tt, []);
      fams.get(tt).push([k, v]);
    }
    console.log('\n  семейства:');
    for (const [tt, list] of [...fams].sort((a, b) => a[0] - b[0])) {
      console.log(`    0x${tt.toString(16).padStart(2, '0')}: ${list.length} тегов`);
    }

    // EQ-семейства детально
    console.log('\n  EQ-теги (0x91-0x94):');
    for (const tt of [0x91, 0x92, 0x93, 0x94]) {
      const list = fams.get(tt);
      if (!list) continue;
      console.log(`    [0x${tt.toString(16)}]`);
      for (const [k, v] of list.sort()) console.log(`      ${k} = ${v}`);
    }

    console.log('\n  переключатели 0x9b:');
    for (const [k, v] of (fams.get(0x9b) ?? []).sort()) console.log(`      ${k} = ${v}`);

    console.log('\n  компрессор 0x46:');
    for (const [k, v] of (fams.get(0x46) ?? []).sort()) console.log(`      ${k} = ${v}`);
  }
}
