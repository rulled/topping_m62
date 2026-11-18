/**
 * КЛЮЧЕВОЙ ЭКСПЕРИМЕНТ: можно ли писать в файл при РАБОТАЮЩЕМ MCC?
 *
 * Раньше считалось (WRITE-METHOD), что MCC перезаписывает файл
 * и нужно останавливать/запускать его (17 с).
 *
 * Но тест показал: MCC НЕ тронул файл за 3 с. Проверяем точнее:
 *   - перезапишет ли он позже?
 *   - применится ли значение на устройстве?
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const w = findActiveWorkspace();
const mixA = () => readWorkspace(findActiveWorkspace().path).Mixer_IN12?.MixA_GAIN;

const cnt = Number(ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'));
console.log(`MCC запущен: ${cnt > 0 ? 'да' : 'нет'}`);
if (cnt === 0) {
  console.log('запускаю MCC...');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(15000);
}

console.log(`\nисходный MixA = ${mixA()}`);
const NEW = mixA() === '7' ? '4' : '7';

console.log(`\n1. пишу MixA = ${NEW} в файл при работающем MCC`);
const ini = readWorkspace(w.path);
ini.Mixer_IN12.MixA_GAIN = NEW;
writeWorkspace(w.path, ini);
console.log(`   в файле: ${mixA()}`);

console.log('\n2. наблюдаю 20 секунд — перезапишет ли MCC?');
for (let i = 1; i <= 4; i++) {
  await sleep(5000);
  const cur = mixA();
  console.log(`   ${i * 5} с: ${cur}  ${cur === NEW ? '(наш)' : '(MCC перезаписал)'}`);
}

console.log('\n3. ИТОГ');
const fin = mixA();
if (fin === NEW) {
  console.log(`   файл СОХРАНИЛ наше значение (${NEW}) — MCC его не трогает`);
  console.log('   НО: применилось ли оно на устройстве — проверять отдельно');
} else {
  console.log(`   MCC ПЕРЕЗАПИСАЛ значение обратно на ${fin}`);
}
