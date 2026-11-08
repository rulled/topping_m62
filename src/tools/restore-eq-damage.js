/**
 * ВОССТАНОВЛЕНИЕ после моих тестов EQ.
 *
 * Что испорчено:
 *   Eq%401: 0|-12|590|15|0  ->  |0|632|0.7|0|
 *   MUTE HP/OTG: 1 -> 0 (как было у пользователя)
 *
 * Порядок: правим файл, перезапускаем MCC, проверяем что EQ Off в UI,
 * только потом снимаем MUTE.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

console.log('═══ ДО ═══');
const w0 = findActiveWorkspace();
let ini = readWorkspace(w0.path);
console.log(`  workspace: ${w0.mode}/${w0.name}`);
console.log(`  Eq%401 = ${ini.EQ_IN1?.['Eq%401']}`);
console.log(`  HP.MUTE = ${ini.Output_HP?.MUTE}, OTG.MUTE = ${ini.Output_OTGOUT?.MUTE}`);
console.log(`  EQ_IN1.Switch = ${ini.EQ_IN1?.Switch}`);

console.log('\n═══ 1. останавливаю MCC ═══');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('═══ 2. правлю файл ═══');
ini = readWorkspace(w0.path);

// восстанавливаем полосу 1 в исходный формат
const origBand = '|0|632|0.7|0';
ini.EQ_IN1['Eq%401'] = origBand;
console.log(`  Eq%401 = ${origBand}`);

// EQ выключаем (было включено моими тестами)
ini.EQ_IN1.Switch = '0';
if (ini.EQ_IN2) ini.EQ_IN2.Switch = '0';
console.log('  EQ_IN1.Switch = 0, EQ_IN2.Switch = 0');

// MUTE снимаем — возвращаем состояние пользователя
ini.Output_HP.MUTE = '0';
ini.Output_OTGOUT.MUTE = '0';
console.log('  HP.MUTE = 0, OTG.MUTE = 0 (как было)');

writeWorkspace(w0.path, ini);

const chk = readWorkspace(w0.path);
console.log('\n  проверка файла:');
console.log(`    Eq%401 = ${chk.EQ_IN1?.['Eq%401']}`);
console.log(`    Eq%402 = ${chk.EQ_IN1?.['Eq%402']}`);
console.log(`    HP.MUTE = ${chk.Output_HP?.MUTE}, OTG.MUTE = ${chk.Output_OTGOUT?.MUTE}`);

console.log('\n═══ 3. запускаю MCC ═══');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(18000);

console.log('═══ 4. ИТОГ ═══');
const fin = readWorkspace(findActiveWorkspace().path);
console.log(`  workspace: ${findActiveWorkspace().mode}/${findActiveWorkspace().name}`);
console.log(`  Eq%401 = ${fin.EQ_IN1?.['Eq%401']}`);
console.log(`  HP.MUTE = ${fin.Output_HP?.MUTE}, OTG.MUTE = ${fin.Output_OTGOUT?.MUTE}`);
console.log(`  IN1.GAIN = ${fin.Input_IN1?.GAIN}  IN2.GAIN = ${fin.Input_IN2?.GAIN}`);
console.log(`  MixA = ${fin.Mixer_IN12?.MixA_GAIN}`);
