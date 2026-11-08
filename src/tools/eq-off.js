/**
 * Выключить EQ IN1 через TogglePattern (без мыши).
 *
 * Кнопка EQ IN1 = [162] (122,270), сейчас On.
 * MUTE выходов уже On — звука не будет.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toggleState(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '  Write-Output ([System.Windows.Automation.TogglePattern]$t).Current.ToggleState',
    '} else { Write-Output "NO" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

function toggle(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '  ([System.Windows.Automation.TogglePattern]$t).Toggle()',
    '  Write-Output "TOGGLED"',
    '} else { Write-Output "NO_TOGGLE" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch (e) { return 'ERR: ' + e.message.slice(0, 80); }
}

// находим EQ IN1 динамически
function findEqBtn() {
  const { items } = dumpTree();
  const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
    .sort((a, b) => a.ly - b.ly);
  return col[5] ?? null;
}

const eq = findEqBtn();
if (!eq) { console.log('кнопка EQ не найдена'); process.exit(1); }

console.log(`EQ IN1: [${eq.i}] (${eq.lx},${eq.ly}) = ${toggleState(eq.i)}`);

if (toggleState(eq.i) === 'On') {
  console.log('  выключаю...');
  console.log('  ' + toggle(eq.i));
  await sleep(2500);
  const { items } = dumpTree();
  const eq2 = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
    .sort((a, b) => a.ly - b.ly)[5];
  console.log(`  теперь: ${eq2 ? toggleState(eq2.i) : '?'}`);
}

console.log('\n=== MUTE выходов (защита) ===');
const { items: it } = dumpTree();
const mutes = it.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1300 && x.lx < 1500 && x.ly > 900 && x.ly < 960);
for (const m of mutes) {
  console.log(`  [${m.i}] (${m.lx},${m.ly}) = ${toggleState(m.i)}`);
}

console.log('\n=== файл ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch = ${i.EQ_IN1?.Switch}`);
console.log(`  HP.MUTE = ${i.Output_HP?.MUTE}, OTG.MUTE = ${i.Output_OTGOUT?.MUTE}`);
