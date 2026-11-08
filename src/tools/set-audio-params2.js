/**
 * ПОПЫТКА СМЕНЫ через ValuePattern.SetValue().
 *
 * ExpandCollapse + SelectionItem не сработали (NOSEL).
 * Пробуем SetValue — стандартный способ для editable combos.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function comboValue(index) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  $vp = [System.Windows.Automation.ValuePattern]$p',
    '  Write-Output ($vp.Current.Value + "|RO=" + $vp.Current.IsReadOnly)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

function trySetValue(index, value) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  try {',
    `    ([System.Windows.Automation.ValuePattern]$p).SetValue('${value}')`,
    '    Write-Output "SET_OK"',
    '  } catch { Write-Output ("SET_FAIL: " + $_.Exception.Message) }',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

/** Клик по комбобоксу + выбор через клавиатуру. */
function selectByKeyboard(index, targetIndex) {
  const RAW = PRELUDE + [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$ep = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) {',
    '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    '  Start-Sleep -Milliseconds 700',
    `  for ($k = 0; $k -lt ${targetIndex}; $k++) {`,
    '    [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
    '    Start-Sleep -Milliseconds 200',
    '  }',
    '  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    '  Write-Output "KEYBOARD_SENT"',
    '} else { Write-Output "NOEXPAND" }',
  ].join('\n');
  return ps(RAW).trim();
}

const { items } = dumpTree();
const combos = items.filter((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 100).sort((a, b) => a.lx - b.lx);

const SR = combos[1];
const BS = combos[2];

console.log('=== ТЕКУЩЕЕ ===');
console.log(`  sample rate [${SR.i}]: ${comboValue(SR.i)}`);
console.log(`  buffer size [${BS.i}]: ${comboValue(BS.i)}`);

console.log('\n=== 1. пробую ValuePattern.SetValue на sample rate ===');
const curSR = comboValue(SR.i).split('|')[0];
const newSR = curSR === '44100' ? '48000' : '44100';
console.log(`  ставлю "${newSR}"`);
console.log('  ' + trySetValue(SR.i, newSR));
await sleep(2500);
console.log(`  после: ${comboValue(SR.i)}`);

console.log('\n=== 2. пробую клавиатуру на buffer size ===');
const curBS = comboValue(BS.i).split('|')[0];
console.log(`  сейчас "${curBS}", пробую выбрать второй пункт`);
console.log('  ' + selectByKeyboard(BS.i, 1));
await sleep(3000);
console.log(`  после: ${comboValue(BS.i)}`);

console.log('\n=== ИТОГ ===');
const srNow = comboValue(SR.i).split('|')[0];
const bsNow = comboValue(BS.i).split('|')[0];
console.log(`  sample rate: ${curSR} -> ${srNow}`);
console.log(`  buffer size: ${curBS} -> ${bsNow}`);
if (srNow !== curSR || bsNow !== curBS) {
  console.log('  *** ХОТЯ БЫ ОДИН ПАРАМЕТР ИЗМЕНИЛСЯ ***');
} else {
  console.log('  ни один не изменился');
}
