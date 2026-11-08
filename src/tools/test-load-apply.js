/**
 * ГИПОТЕЗА: чтобы применить изменения из INI, нужно нажать
 * "Load preset1/2" (MCC перечитает файл и запишет в устройство).
 *
 * Проверяем: пишем 48V=1 в файл -> жмём Load preset1 -> смотрим UI и файл.
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { dumpTree, invoke } from './uia.js';
import { ps, PRELUDE } from './uia.js';
import { inputStates } from './uia-helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = findActiveWorkspace();
console.log(`workspace: ${ws.mode}/${ws.name}\n`);

const backup = ws.path + '.bak2';
copyFileSync(ws.path, backup);

// читаем исходное
let ini = readWorkspace(ws.path);
console.log(`48V в файле ДО: ${ini.Input_IN1['48V']}`);
console.log(`GAIN IN1 ДО: ${ini.Input_IN1['GAIN']}`);

// ставим заведомо другое значение
const target48 = ini.Input_IN1['48V'] === '1' ? '0' : '1';
ini.Input_IN1['48V'] = target48;
ini.Input_IN1['GAIN'] = '30';
writeWorkspace(ws.path, ini);
console.log(`\nзаписал в файл: 48V=${target48}, GAIN=30`);

await sleep(1000);

// найти Load preset1
const { items } = dumpTree();
const load = items.find((x) => (x.name || '').trim() === 'Load preset1');
if (!load) { console.error('Load preset1 не найден'); process.exit(1); }
console.log(`\nнажимаю Load preset1 [${load.i}]`);
console.log('  ' + (await invoke(load.i)));

await sleep(4000);

// что стало в файле
const after = readWorkspace(ws.path);
console.log(`\n48V в файле ПОСЛЕ: ${after.Input_IN1['48V']}`);
console.log(`GAIN IN1 ПОСЛЕ: ${after.Input_IN1['GAIN']}`);

// состояние кнопок
const states = inputStates().filter((s) => s.x < 350 && s.w > 80);
console.log('\nкнопки IN1:');
for (const s of states) console.log(`  (${s.x},${s.y}) ${s.state}`);

console.log(`\nбэкап: ${backup}`);
