/**
 * Проверка: раскрывается ли панель эффектов и находятся ли кнопки реверба.
 */
import { ensureReverbPanelOpen, findReverbButtons, setReverbType } from '../ui-control.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reverb = () => readWorkspace(findActiveWorkspace().path).Effect_Integration?.ReverbType;

console.log(`тип реверба сейчас: ${reverb()}`);

console.log('\n=== 1. раскрываю панель эффектов ===');
console.log(' ', JSON.stringify(ensureReverbPanelOpen()));
await sleep(2500);

console.log('\n=== 2. ищу кнопки реверба ===');
const btns = findReverbButtons();
console.log(' ', JSON.stringify(btns));

if (!btns) {
  console.log('\nкнопки не найдены — панель не раскрылась или разметка другая');
  process.exit(1);
}

console.log('\n=== 3. пробую переключить на LIVE ===');
try {
  console.log(' ', setReverbType('LIVE'));
} catch (e) {
  console.log('  ошибка:', e.message);
}
await sleep(2500);
console.log(`  тип после: ${reverb()}`);

console.log('\n=== 4. возвращаю ===');
const orig = reverb();
if (orig !== 'Bypass') {
  try { setReverbType('Bypass'); } catch { /* */ }
  await sleep(2000);
}
console.log(`  итог: ${reverb()}`);
