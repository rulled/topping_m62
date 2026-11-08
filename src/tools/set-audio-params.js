/**
 * ЗАПИСЬ SAMPLE RATE И BUFFER SIZE.
 *
 * Читать умею (read-audio-params.js), но менять — нет.
 * Проверяем: можно ли выбрать значение в комбобоксе через UIAutomation.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Прочитать значение комбобокса. */
function comboValue(index) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

/**
 * Выбрать значение в комбобоксе по имени.
 * Раскрываем -> находим ListItem с нужным именем -> Select -> Collapse.
 */
function selectComboItem(index, value) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${index})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 0 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 900',
    '$all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$done = $false',
    'for ($i=0; $i -lt $all2.Count; $i++) {',
    '  $e = $all2.Item($i)',
    `  if ($e.Current.Name -eq '${value}' -and $e.Current.ControlType.ProgrammaticName -eq 'ControlType.ListItem') {`,
    '    $sp = $null',
    '    if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) {',
    '      ([System.Windows.Automation.SelectionItemPattern]$sp).Select()',
    '      Write-Output "SELECTED"',
    '      $done = $true',
    '      break',
    '    }',
    '  }',
    '}',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
    'Start-Sleep -Milliseconds 400',
    'if (-not $done) { Write-Output "NOTFOUND" }',
  ].join('\n');
  return ps(RAW).trim();
}

// находим комбобоксы
const { items } = dumpTree();
const combos = items.filter((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 100)
  .sort((a, b) => a.lx - b.lx);

console.log('комбобоксы в шапке:');
for (const c of combos) console.log(`  [${c.i}] (${c.lx},${c.ly})`);

const SR = combos[1]; // sample rate
const BS = combos[2]; // buffer size

console.log(`\nsample rate: [${SR.i}] = ${comboValue(SR.i)}`);
console.log(`buffer size: [${BS.i}] = ${comboValue(BS.i)}`);

console.log('\n=== 1. меняю sample rate 44100 -> 48000 ===');
const curSR = comboValue(SR.i);
const newSR = curSR === '44100' ? '48000' : '44100';
console.log(`  выбираю ${newSR}`);
console.log('  ' + selectComboItem(SR.i, newSR));
await sleep(3000);
const afterSR = comboValue(SR.i);
console.log(`  результат: ${afterSR}  ${afterSR === newSR ? 'OK' : 'НЕ СРАБОТАЛО'}`);

// вернуть
if (afterSR === newSR) {
  console.log(`\n  возвращаю ${curSR}`);
  console.log('  ' + selectComboItem(SR.i, curSR));
  await sleep(3000);
  console.log(`  сейчас: ${comboValue(SR.i)}`);
}

console.log('\n=== 2. меняю buffer size 32 -> 64 ===');
const curBS = comboValue(BS.i);
const newBS = curBS === '32' ? '64' : '32';
console.log(`  выбираю ${newBS}`);
console.log('  ' + selectComboItem(BS.i, newBS));
await sleep(3000);
const afterBS = comboValue(BS.i);
console.log(`  результат: ${afterBS}  ${afterBS === newBS ? 'OK' : 'НЕ СРАБОТАЛО'}`);

if (afterBS === newBS) {
  console.log(`\n  возвращаю ${curBS}`);
  console.log('  ' + selectComboItem(BS.i, curBS));
  await sleep(3000);
  console.log(`  сейчас: ${comboValue(BS.i)}`);
}
