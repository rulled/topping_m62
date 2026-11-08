/**
 * ПРОВЕРКА: пишется ли EQ_IN1.Switch в Live-режиме?
 *
 * В NOTES §8 было записано: "EQ_IN1.Switch в Live НЕ пишется (MCC forces 0)".
 * Проверяем это утверждение заново — возможно, оно ошибочно.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const sw = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.Switch;

console.log(`EQ_IN1.Switch сейчас: ${sw()}`);

console.log('\n=== 1. останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('\n=== 2. записываю Switch = 1 в файл ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.EQ_IN1.Switch = '1';
writeWorkspace(w.path, ini);
console.log(`  в файле: ${sw()}`);

console.log('\n=== 3. запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);

const after = sw();
console.log(`\n=== 4. результат ===`);
console.log(`  Switch после запуска MCC: ${after}`);
if (after === '1') {
  console.log('  *** ПИШЕТСЯ! Прежнее утверждение "не пишется" — ОШИБОЧНО ***');
} else {
  console.log('  не пишется — MCC сбросил в 0, прежнее утверждение подтверждено');
}

// проверим, что в UI
console.log('\n=== 5. пробую UI: кнопка включения EQ ===');
const { dumpTree } = await import('./uia.js');
const { items } = dumpTree();
// ищем кнопки рядом с EQ-областью
const eqArea = items.filter((x) => x.cls === 'QPushButton' && x.ly > 1250 && x.ly < 1600 && x.lx < 550);
console.log(`  кнопок в области EQ: ${eqArea.length}`);
for (const b of eqArea) console.log(`    [${b.i}] (${b.lx},${b.ly}) "${(b.name || '').slice(0, 20)}"`);

// вернуть в 0 если записалось
if (after === '1') {
  console.log('\n(оставляю включённым для дальнейшей работы)');
}
