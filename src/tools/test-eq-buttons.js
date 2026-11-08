/**
 * ЧТО ДЕЛАЮТ КНОПКИ [368] и [369] в области EQ?
 *
 * Расположены на (494,1317) и (494,1373) — это кнопки рядом
 * с панелью EQ микрофона.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  const e = i.Effect_Integration ?? {};
  return {
    eqIn1Switch: i.EQ_IN1?.Switch,
    eqIn1Band1: i.EQ_IN1?.['Eq%401'],
    eqIn2Switch: i.EQ_IN2?.Switch,
    ntype: e.NoiseReductionType,
    muteFx: e.MuteFX,
    compSwitch: i.Compressor?.Switch,
    reverbType: e.ReverbType,
  };
};

function click(i) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

console.log('=== исходное ===');
console.log(' ', JSON.stringify(state()));

// проверим, есть ли у кнопок Toggle-паттерн
const { items } = dumpTree();
for (const idx of ['368', '369']) {
  const el = items.find((x) => String(x.i) === idx);
  if (!el) { console.log(`  [${idx}] не найден`); continue; }
  console.log(`\n[${idx}] ${el.cls} (${el.lx},${el.ly}) pats=${JSON.stringify(el.pats)}`);

  // проверяем Toggle
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '  Write-Output ("TOGGLE state=" + ([System.Windows.Automation.TogglePattern]$t).Current.ToggleState)',
    '} else { Write-Output "NO_TOGGLE" }',
  ].join('\n');
  console.log('  ' + ps(RAW).trim());
}

console.log('\n=== нажимаю [368] ===');
console.log('  ' + click(368));
await sleep(2500);
console.log(' ', JSON.stringify(state()));

console.log('\n=== нажимаю [369] ===');
console.log('  ' + click(369));
await sleep(2500);
console.log(' ', JSON.stringify(state()));

console.log('\n=== возвращаю [368] ===');
console.log('  ' + click(368));
await sleep(2000);
console.log(' ', JSON.stringify(state()));
