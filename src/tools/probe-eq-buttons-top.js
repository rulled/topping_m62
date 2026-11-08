/**
 * Что за кнопки [166], [183], [194] над IN1/IN2?
 *
 * Они на y=506, а подписи IN1/IN2 на y=584. Возможно это кнопки EQ!
 * Пробуем нажать и смотреть на EQ_IN1.Switch.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const psx = (cmd) => {
  try { return execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

const eqState = () => {
  const i = readWorkspace(findActiveWorkspace().path);
  return {
    in1: i.EQ_IN1?.Switch,
    in2: i.EQ_IN2?.Switch,
    hp: i.EQ_HP?.Switch,
  };
};

function clickByIndex(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

// СНАЧАЛА ставим MUTE на выходы — чтобы EQ-тест не дал звук
console.log('=== защита: ставлю MUTE на выходы ===');
const w0 = findActiveWorkspace();
const ini0 = readWorkspace(w0.path);
const origHpMute = ini0.Output_HP?.MUTE;
const origOtgMute = ini0.Output_OTGOUT?.MUTE;
ini0.Output_HP.MUTE = 'true';
ini0.Output_OTGOUT.MUTE = 'true';
writeWorkspace(w0.path, ini0);
console.log(`  HP.MUTE: ${origHpMute} -> true`);
console.log(`  OTG.MUTE: ${origOtgMute} -> true`);
console.log('  (потребуется перезапуск MCC для применения)');

const { items } = dumpTree();
console.log('\n=== ДО ===');
console.log(' ', JSON.stringify(eqState()));

for (const idx of [166, 183, 194]) {
  const el = items.find((x) => String(x.i) === String(idx));
  if (!el) continue;
  console.log(`\n--- кнопка [${idx}] (${el.lx},${el.ly}) ---`);
  const before = eqState();
  const r = clickByIndex(idx);
  await sleep(2500);
  const after = eqState();
  console.log(`  ${r}`);
  console.log(`  EQ: IN1 ${before.in1}->${after.in1}, IN2 ${before.in2}->${after.in2}`);
  if (String(before.in1) !== String(after.in1) || String(before.in2) !== String(after.in2)) {
    console.log('  *** ЭТО КНОПКА EQ! ***');
    // вернуть
    clickByIndex(idx);
    await sleep(1500);
    break;
  }
}

console.log('\n=== ПОСЛЕ ===');
console.log(' ', JSON.stringify(eqState()));
