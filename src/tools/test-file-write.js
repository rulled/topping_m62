/**
 * ПРОВЕРКА: можно ли управлять устройством через INI-файл?
 *
 * 1) читаем текущее значение 48V из файла
 * 2) меняем его в файле
 * 3) смотрим, изменилось ли состояние в UI MCC
 *
 * Это НЕ запись в устройство напрямую — файл читает сам MCC.
 * Если MCC применит — значит канал работает.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { inputStates } from './uia-helpers.js';

const ws = findActiveWorkspace();
if (!ws) { console.error('workspace не найден'); process.exit(1); }
console.log(`активный workspace: ${ws.mode}/${ws.name}`);
console.log(`путь: ${ws.path}\n`);

// бэкап
const backup = ws.path + '.bak';
copyFileSync(ws.path, backup);
console.log(`бэкап: ${backup}`);

const ini = readWorkspace(ws.path);
const before = ini.Input_IN1?.['48V'];
console.log(`\n[Input_IN1] 48V ДО = ${before}`);

const target = before === '1' ? '0' : '1';
ini.Input_IN1['48V'] = target;
writeWorkspace(ws.path, ini);
console.log(`записал 48V = ${target}`);

// ждём и смотрим UI
await new Promise((r) => setTimeout(r, 2500));

try {
  const states = inputStates();
  const in1 = states.filter((s) => s.x < 350 && s.w > 80);
  console.log('\nсостояние кнопок IN1 после записи в файл:');
  for (const s of in1) {
    console.log(`  [${s.i}] (${s.x},${s.y}) ${s.state}`);
  }
} catch (e) {
  console.log('не удалось прочитать UI:', e.message);
}

// проверить, не перезаписал ли MCC файл обратно
const after = readWorkspace(ws.path);
console.log(`\n[Input_IN1] 48V ПОСЛЕ = ${after.Input_IN1?.['48V']}`);
console.log(after.Input_IN1?.['48V'] === target
  ? 'MCC принял значение из файла'
  : 'MCC ПЕРЕЗАПИСАЛ файл своим значением');

console.log(`\nдля отката: copy "${backup}" "${ws.path}"`);
