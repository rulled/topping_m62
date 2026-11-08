/**
 * ПОЧЕМУ sample rate / buffer size не меняются?
 *
 * "SELECTED" прошло, но значение осталось. Варианты:
 *   1) драйвер не даёт сменить на лету (нужно остановить аудио)
 *   2) выбор не применился, т.к. нужно нажать OK в диалоге
 *   3) значение меняется, но чтение возвращает старое
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
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

/** Что выбранo через SelectionPattern. */
function comboSelection(index) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$sel = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$sel)) {',
    '  $cur = ([System.Windows.Automation.SelectionPattern]$sel).Current.GetSelection()',
    '  if ($cur.Length -gt 0) { Write-Output ("selected=" + $cur[0].Current.Name) } else { Write-Output "empty" }',
    '} else { Write-Output "NOSEL" }',
  ].join('\n');
  return ps(RAW).trim();
}

const { items } = dumpTree();
const combos = items.filter((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 100).sort((a, b) => a.lx - b.lx);

console.log('=== ТЕКУЩЕЕ ===');
for (const c of combos) {
  console.log(`  [${c.i}] value=${comboValue(c.i)}  ${comboSelection(c.i)}`);
}

// проверим, есть ли диалог/сообщение после попытки смены
console.log('\n=== ПРОБУЮ СМЕНИТЬ И СМОТРЕТЬ, ЧТО ПОЯВИТСЯ ===');
const SR = combos[1];

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  `$combo = $all.Item(${SR.i})`,
  '$ep = $null',
  'if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) {',
  '  ([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
  '}',
  'Start-Sleep -Milliseconds 900',
  '$all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$items = @()',
  'for ($i=0; $i -lt $all2.Count; $i++) {',
  '  $e = $all2.Item($i)',
  '  if ($e.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem") {',
  '    $items += ($i.ToString() + ":" + $e.Current.Name)',
  '  }',
  '}',
  'Write-Output ("ITEMS=" + ($items -join ","))',
  '([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
].join('\n');
console.log(ps(RAW).trim().slice(0, 300));

await sleep(1000);

// все диалоги/окна после попытки
console.log('\n=== ВСЕ ОКНА MCC ===');
const WINS = String.raw`
Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("PID=" + $_.Id + " title='" + $_.MainWindowTitle + "'")
}
`;
console.log(ps(WINS).trim());

// проверим, поменялось ли что-то в реестре (sample rate может там)
console.log('\n=== РЕЕСТР (может хранить sample rate) ===');
const REG = String.raw`
Get-ItemProperty -Path 'HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62' -ErrorAction SilentlyContinue |
  Select-Object * -ExcludeProperty PS* | Format-List
`;
try {
  console.log(ps(REG).trim().slice(0, 500));
} catch (e) {
  console.log('  ошибка:', e.message.slice(0, 80));
}
