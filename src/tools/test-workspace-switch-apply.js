/**
 * ГИПОТЕЗА: смена workspace в UI заставляет MCC перечитать файл.
 *
 * Если да — это АЛЬТЕРНАТИВА перезапуску (17 с -> ~1 с).
 *
 * Метод: правим файл workspace X, переключаемся на Y и обратно на X,
 * смотрим на слайдер в UI.
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace, listWorkspaces } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Значение слайдера Mix A из UI. */
function uiMixA() {
  const { items } = dumpTree();
  const sliders = items.filter((x) => x.cls === 'QSlider' && x.ly > 450 && x.ly < 620 && x.lx > 1100)
    .sort((a, b) => a.lx - b.lx);
  if (!sliders.length) return null;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${sliders[0].i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.RangeValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const out = ps(RAW).trim();
  return out === 'NOPATTERN' ? null : Number(out);
}

/** Текущее имя workspace в комбобоксе MCC. */
function uiWorkspace() {
  const { items } = dumpTree();
  const combo = items.find((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 120);
  if (!combo) return null;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${combo.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else {',
    '  $sel = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$sel)) {',
    '    $cur = ([System.Windows.Automation.SelectionPattern]$sel).Current.GetSelection()',
    '    if ($cur.Length -gt 0) { Write-Output $cur[0].Current.Name } else { Write-Output "EMPTY" }',
    '  } else { Write-Output "NOPATTERN" }',
    '}',
  ].join('\n');
  return ps(RAW).trim();
}

const ws = findActiveWorkspace();
console.log(`=== 1. исходное ===`);
console.log(`  файл: ${ws.mode}/${ws.name}`);
console.log(`  файл MixA: ${readWorkspace(ws.path).Mixer_IN12?.MixA_GAIN}`);
console.log(`  UI MixA: ${uiMixA()}`);
console.log(`  UI workspace: ${uiWorkspace()}`);

console.log('\n=== 2. меняю файл при работающем MCC ===');
const cur = readWorkspace(ws.path).Mixer_IN12?.MixA_GAIN;
const NEW = cur === '4' ? '8' : '4';
const ini = readWorkspace(ws.path);
ini.Mixer_IN12.MixA_GAIN = NEW;
writeWorkspace(ws.path, ini);
console.log(`  записал MixA = ${NEW} в ${ws.name}`);
await sleep(2000);
console.log(`  UI MixA (не должно измениться): ${uiMixA()}`);

console.log('\n=== 3. переключаю workspace через UI (туда-обратно) ===');
// найдём другой workspace того же режима
const others = listWorkspaces().filter((x) => x.mode === ws.mode && x.name !== ws.name);
console.log(`  другие Live-workspace: ${others.map((o) => o.name).join(', ') || 'нет'}`);

if (!others.length) {
  console.log('  нет другого workspace для переключения — тест невозможен');
  process.exit(0);
}

const target = others[0];

/** Выбрать элемент в комбобоксе по имени. */
function selectWorkspace(name) {
  const { items } = dumpTree();
  const combo = items.find((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 120);
  if (!combo) return 'нет комбобокса';
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${combo.i})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 0 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 800',
    '$all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$found = $false',
    'for ($i=0; $i -lt $all2.Count; $i++) {',
    '  $e = $all2.Item($i)',
    `  if ($e.Current.Name -eq '${name}') {`,
    '    $sp = $null',
    '    if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) {',
    '      ([System.Windows.Automation.SelectionItemPattern]$sp).Select()',
    '      Write-Output "SELECTED"',
    '      $found = $true',
    '      break',
    '    }',
    '  }',
    '}',
    'if (-not $found) { ([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse(); Write-Output "NOTFOUND" }',
  ].join('\n');
  return ps(RAW).trim();
}

console.log(`  переключаюсь на "${target.name}"...`);
console.log('  ', selectWorkspace(target.name));
await sleep(4000);
console.log(`  UI workspace: ${uiWorkspace()}`);

console.log(`\n  возвращаюсь на "${ws.name}"...`);
console.log('  ', selectWorkspace(ws.name));
await sleep(4000);
console.log(`  UI workspace: ${uiWorkspace()}`);

console.log('\n=== 4. ПРОВЕРКА: обновился ли слайдер? ===');
const after = uiMixA();
console.log(`  файл MixA: ${readWorkspace(findActiveWorkspace().path).Mixer_IN12?.MixA_GAIN}`);
console.log(`  UI MixA: ${after}`);
console.log(`  ожидали ${NEW}`);

console.log('\n=== ВЫВОД ===');
if (after === Number(NEW)) {
  console.log('  *** СМЕНА WORKSPACE ПРИМЕНЯЕТ ФАЙЛ! 17-секундный цикл можно заменить ***');
} else {
  console.log('  смена workspace НЕ применяет правку файла');
}
