/**
 * ПРОВЕРКА ТИПОВ ФИЛЬТРОВ — с ДИНАМИЧЕСКИМ поиском комбобоксов.
 *
 * Индексы UIA меняются при перерисовке. Ищем ComboBoxS1M3 каждый раз заново.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const band1 = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

/** Найти первый ComboBoxS1M3 (тип полосы 1). */
function findTypeCombo() {
  const { items } = dumpTree();
  const combos = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx);
  return combos.length ? combos[0] : null;
}

function setCombo(idx, position) {
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
    '  Start-Sleep -Milliseconds 220',
    '}',
    'Start-Sleep -Milliseconds 200',
    '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    'Start-Sleep -Milliseconds 500',
    'Write-Output "SET"',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
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
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

const TYPE_NAMES = ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf'];

console.log('=== ДО ===');
console.log(`  Eq%401 = ${band1()}`);

const first = findTypeCombo();
console.log(`  первый ComboBoxS1M3: [${first?.i}] (${first?.lx},${first?.ly}) = "${first ? comboValue(first.i) : '?'}"`);

console.log('\n=== ПЕРЕБИРАЮ ТИПЫ ===');
const results = [];
for (let pos = 0; pos < TYPE_NAMES.length; pos++) {
  const combo = findTypeCombo();
  if (!combo) { console.log('  комбобокс пропал — окно закрылось?'); break; }

  const r = setCombo(combo.i, pos);
  await sleep(2200);

  const combo2 = findTypeCombo();
  const cur = combo2 ? comboValue(combo2.i) : '?';
  const band = band1();
  const parts = String(band).split('|').filter((x) => x !== '');
  const typeNum = parts[0];

  console.log(`  позиция ${pos}: комбобокс="${cur}", файл тип=${typeNum}  (${r})`);
  results.push({ pos, expected: TYPE_NAMES[pos], actual: cur, typeNum });
}

console.log('\n=== ИТОГ ===');
console.log('  позиция | имя        | тип в файле');
for (const r of results) {
  console.log(`     ${r.pos}    | ${String(r.actual).padEnd(10)} | ${r.typeNum}`);
}

// вернуть peaking
const c = findTypeCombo();
if (c) { setCombo(c.i, 0); await sleep(1500); }
console.log(`\n  вернул peaking, файл: ${band1()}`);
