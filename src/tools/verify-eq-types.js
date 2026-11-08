/**
 * ПРОВЕРКА СООТВЕТСТВИЯ ТИПОВ ФИЛЬТРОВ.
 *
 * Гипотеза: peaking=0, lowpass=1, highpass=2, lowshelf=3, highshelf=4
 * (порядок в комбобоксе сверху вниз).
 *
 * Проверяем: выбираем "lowshelf" и смотрим, что записалось в файл.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const band1 = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

/** Выбрать значение в комбобоксе клавиатурой (работает, проверено §79). */
function setCombo(idx, position) {
  const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  const RAW = PRELUDE + [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${idx})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 1 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 800',
    '[System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
    'Start-Sleep -Milliseconds 250',
    `for ($k = 0; $k -lt ${position}; $k++) {`,
    '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
    '  Start-Sleep -Milliseconds 200',
    '}',
    'Start-Sleep -Milliseconds 200',
    '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    'Start-Sleep -Milliseconds 400',
    'Write-Output "SET"',
  ].join('\n');
  return ps(RAW).trim();
}

function comboValue(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NP" }',
  ].join('\n');
  return ps(RAW).trim();
}

const TYPE_NAMES = ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf'];

console.log('=== ДО ===');
console.log(`  Eq%401 = ${band1()}`);
console.log(`  комбобокс [21] = "${comboValue(21)}"`);

const { items } = dumpTree();
const combo21 = items.find((x) => String(x.i) === '21');
if (!combo21) { console.log('комбобокс [21] не найден — окно EQ закрыто?'); process.exit(1); }

console.log('\n=== ВЫБИРАЮ КАЖДЫЙ ТИП И СМОТРЮ В ФАЙЛ ===');
for (let pos = 0; pos < TYPE_NAMES.length; pos++) {
  console.log(`\n--- ${TYPE_NAMES[pos]} (позиция ${pos}) ---`);
  const r = setCombo(21, pos);
  await sleep(2000);
  const cur = comboValue(21);
  const band = band1();
  console.log(`  setCombo: ${r}, комбобокс="${cur}"`);
  console.log(`  файл: ${band}`);
  // извлекаем тип из строки |тип|частота|Q|gain|
  const parts = String(band).split('|').filter((x) => x !== '');
  console.log(`  тип в файле: ${parts[0]}`);
}

// вернуть peaking
console.log('\n=== возвращаю peaking ===');
setCombo(21, 0);
await sleep(1500);
console.log(`  файл: ${band1()}`);
