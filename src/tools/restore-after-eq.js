/**
 * ВОССТАНОВЛЕНИЕ исходного состояния пользователя:
 *   - EQ_IN1.Switch = 0
 *   - Output_HP.MUTE = 0, Output_OTGOUT.MUTE = 0
 *
 * Снимаем MUTE ТОЛЬКО когда EQ выключен — чтобы не было звука от EQ.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

console.log('=== ДО ===');
const w0 = findActiveWorkspace();
let ini = readWorkspace(w0.path);
console.log(`  workspace: ${w0.mode}/${w0.name}`);
console.log(`  EQ_IN1.Switch = ${ini.EQ_IN1?.Switch}`);
console.log(`  HP.MUTE = ${ini.Output_HP?.MUTE}, OTG.MUTE = ${ini.Output_OTGOUT?.MUTE}`);

console.log('\n=== останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('=== правлю файл ===');
ini = readWorkspace(w0.path);
ini.EQ_IN1.Switch = '0';
if (ini.Output_HP) ini.Output_HP.MUTE = '0';
if (ini.Output_OTGOUT) ini.Output_OTGOUT.MUTE = '0';
writeWorkspace(w0.path, ini);

const chk = readWorkspace(w0.path);
console.log(`  EQ_IN1.Switch = ${chk.EQ_IN1?.Switch}`);
console.log(`  HP.MUTE = ${chk.Output_HP?.MUTE}, OTG.MUTE = ${chk.Output_OTGOUT?.MUTE}`);

console.log('\n=== запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(17000);

console.log('\n=== ПОСЛЕ ===');
const fin = readWorkspace(findActiveWorkspace().path);
console.log(`  workspace: ${findActiveWorkspace().mode}/${findActiveWorkspace().name}`);
console.log(`  EQ_IN1.Switch = ${fin.EQ_IN1?.Switch}`);
console.log(`  HP.MUTE = ${fin.Output_HP?.MUTE}, OTG.MUTE = ${fin.Output_OTGOUT?.MUTE}`);
console.log(`  IN1.GAIN = ${fin.Input_IN1?.GAIN}`);
console.log(`  Eq%401 = ${fin.EQ_IN1?.['Eq%401']}`);
