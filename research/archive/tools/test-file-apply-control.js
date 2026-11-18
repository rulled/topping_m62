/**
 * КОНТРОЛЬНЫЙ ТЕСТ: применяется ли правка файла БЕЗ "Load settings"?
 *
 * Сравниваем два случая:
 *   A) правка файла + запуск MCC (без команды)
 *   B) правка файла + Load settings + запуск MCC
 *
 * Если результат одинаковый — команда ничего не делает.
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const MIX = process.env.TEST_MIX ?? '9';

console.log(`тестовое значение MixA = ${MIX}\n`);

console.log('1. останавливаю MCC');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

const w = findActiveWorkspace();
const before = readWorkspace(w.path);
console.log(`2. файл до: MixA=${before.Mixer_IN12?.MixA_GAIN} HP=${before.Output_HP?.GAIN}`);

const ini = readWorkspace(w.path);
ini.Mixer_IN12.MixA_GAIN = MIX;
writeWorkspace(w.path, ini);
const afterWrite = readWorkspace(w.path);
console.log(`3. записал MixA=${MIX}, в файле: ${afterWrite.Mixer_IN12?.MixA_GAIN}`);

console.log('4. запускаю MCC БЕЗ Load settings...');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(15000);

const fin = readWorkspace(findActiveWorkspace().path);
console.log(`\n5. файл после запуска MCC: MixA=${fin.Mixer_IN12?.MixA_GAIN}`);
console.log(`   ожидали ${MIX}, получили ${fin.Mixer_IN12?.MixA_GAIN}`);

if (String(fin.Mixer_IN12?.MixA_GAIN) === MIX) {
  console.log('\n   => правка файла ПРИМЕНИЛАСЬ без Load settings');
  console.log('   => Load settings, вероятно, НЕ НУЖНА для применения');
} else {
  console.log('\n   => правка файла НЕ применилась (MCC перезаписал своим)');
}
