/**
 * ПРОВЕРКА: пишутся ли ПОЛОСЫ EQ в Live-режиме?
 *
 * Если Switch не пишется — возможно, и полосы не пишутся.
 * Это определит, доступен ли EQ в Live вообще.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const eq = () => {
  const i = readWorkspace(findActiveWorkspace().path);
  return { sw: i.EQ_IN1?.Switch, b1: i.EQ_IN1?.['Eq%401'], b2: i.EQ_IN1?.['Eq%402'] };
};

console.log('=== ДО ===');
console.log(' ', JSON.stringify(eq()));

console.log('\n=== 1. останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('=== 2. меняю ВСЁ: Switch=1, Eq%401 gain 0->8, Eq%402 -4->+3 ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.EQ_IN1.Switch = '1';
ini.EQ_IN1['Eq%401'] = '|0|632|0.7|8';
ini.EQ_IN1['Eq%402'] = '|0|632|0.7|3';
writeWorkspace(w.path, ini);
console.log('  в файле:', JSON.stringify(eq()));

console.log('\n=== 3. запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);

const after = eq();
console.log('\n=== 4. РЕЗУЛЬТАТ ===');
console.log(' ', JSON.stringify(after));

const switchOk = after.sw === '1';
const b1Ok = String(after.b1).includes('|8');
const b2Ok = String(after.b2).includes('|3');

console.log(`  Switch записан:      ${switchOk ? 'ДА' : 'нет'}`);
console.log(`  Eq%401 gain=8:       ${b1Ok ? 'ДА' : 'нет'} (${after.b1})`);
console.log(`  Eq%402 gain=3:       ${b2Ok ? 'ДА' : 'нет'} (${after.b2})`);

console.log('\n=== ВЫВОД ===');
if (b1Ok || b2Ok) {
  console.log('  ПОЛОСЫ ПИШУТСЯ — EQ доступен в Live, только Switch сбрасывается');
} else if (switchOk) {
  console.log('  Switch пишется, полосы нет — странно');
} else {
  console.log('  НИЧЕГО НЕ ПИШЕТСЯ — EQ полностью недоступен в Live');
  console.log('  (значения из файла применятся только при включении EQ в UI)');
}
