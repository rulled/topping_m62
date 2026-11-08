/**
 * EQ_HP.Switch В PRO — пишется ли?
 *
 * Устройство сейчас в Pro. Проверяем, можно ли включить EQ наушников.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => {
  try { return execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

const ws = findActiveWorkspace();
console.log(`workspace: ${ws.mode}/${ws.name}`);
let ini = readWorkspace(ws.path);
if (!ini.EQ_HP) {
  console.log('НЕТ секции EQ_HP — устройство не в Pro. Прерываю.');
  process.exit(1);
}

console.log('\n=== ДО ===');
console.log(`  EQ_HP.Switch: ${ini.EQ_HP.Switch}`);
console.log(`  EQ_HP.GainOutput: ${ini.EQ_HP.GainOutput}`);
console.log(`  Eq%401: ${ini.EQ_HP['Eq%401']}`);

console.log('\n=== 1. останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('=== 2. пишу Switch=1 и меняю полосу 1 ===');
ini = readWorkspace(ws.path);
ini.EQ_HP.Switch = '1';
ini.EQ_HP['Eq%401'] = '0|6|40|0.7|1';
writeWorkspace(ws.path, ini);
const written = readWorkspace(ws.path);
console.log(`  в файле: Switch=${written.EQ_HP.Switch}, Eq%401=${written.EQ_HP['Eq%401']}`);

console.log('\n=== 3. запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(18000);

const after = readWorkspace(findActiveWorkspace().path);
console.log('\n=== 4. РЕЗУЛЬТАТ ===');
const sw = after.EQ_HP?.Switch;
const b1 = after.EQ_HP?.['Eq%401'];
console.log(`  EQ_HP.Switch: ${sw}`);
console.log(`  Eq%401: ${b1}`);

console.log('\n=== ВЫВОД ===');
if (sw === '1') {
  console.log('  *** EQ_HP.Switch ПИШЕТСЯ В PRO! ***');
  console.log('  EQ наушников можно включить через файл.');
} else {
  console.log('  EQ_HP.Switch не пишется и в Pro — сбрасывается в 0');
}
if (String(b1).includes('|40|')) {
  console.log('  Полоса записалась (freq=40).');
} else {
  console.log('  Полоса не записалась.');
}

// вернуть исходное
const restore = readWorkspace(findActiveWorkspace().path);
restore.EQ_HP.Switch = '0';
restore.EQ_HP['Eq%401'] = '0|9|35|0.5395|1';
writeWorkspace(findActiveWorkspace().path, restore);
console.log('\n(вернул Switch=0, Eq%401=0|9|35|0.5395|1)');
