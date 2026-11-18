/**
 * Проверка, что исправление локали работает.
 */
import { ps as uiaPs, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

console.log('=== 1. СЫРОЕ значение scale ===');
const raw = uiaPs(PRELUDE + 'Write-Output $script:scale').trim();
console.log(`  raw = ${JSON.stringify(raw)}`);
console.log(`  Number(raw) = ${Number(raw)}                          <-- NaN под русской локалью`);
console.log(`  Number(raw.replace(',','.')) = ${Number(raw.replace(',', '.'))}   <-- правильно`);

console.log('\n=== 2. ui-control.readScale (исправлено) ===');
const ui = await import('../ui-control.js');
// проверим косвенно: nudgeReverb должен сдвинуть значение
const e0 = () => readWorkspace(findActiveWorkspace().path).Effect_Integration ?? {};
const before = Number(e0().DecayStudio);
console.log(`  decay до: ${before}`);

const r = ui.nudgeReverb('decay', 1);
console.log(`  nudgeReverb('decay', +1): ${JSON.stringify(r)}`);
await new Promise((x) => setTimeout(x, 1800));

const after = Number(e0().DecayStudio);
console.log(`  decay после: ${after}`);
console.log(`  ${after !== before ? 'РАБОТАЕТ (значение изменилось)' : 'НЕ РАБОТАЕТ'}`);

// вернуть
if (after !== before) {
  ui.nudgeReverb('decay', before - after);
  await new Promise((x) => setTimeout(x, 1500));
  console.log(`  вернул decay: ${Number(e0().DecayStudio)}`);
}

console.log('\n=== 3. Состояние реверба ===');
const e = e0();
console.log(`  Type: ${e.ReverbType}`);
console.log(`  Level: ${e.ReverbStudio}`);
console.log(`  DryWet: ${e.DryWetStudio}`);
console.log(`  Decay: ${e.DecayStudio}`);
console.log(`  Width: ${e.WidthStudio}`);
