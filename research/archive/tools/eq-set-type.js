/**
 * СМЕНА ТИПА ФИЛЬТРА EQ ЧЕРЕЗ POPUP.
 *
 * Ранее (NOTES §97) считалось, что тип меняется ТОЛЬКО реальным кликом:
 * у комбобокса нет SelectionPattern, а ValuePattern.SetValue не применяется.
 *
 * НО у элементов выпадающего списка (`QComboBoxPrivateContainer` ->
 * `QComboBoxListView` -> пункты) ЕСТЬ **InvokePattern** и
 * **SelectionItemPattern**. Значит смена типа возможна БЕЗ мыши:
 *   Expand() на комбобоксе -> Invoke()/Select() на нужном пункте.
 *
 * Запуск:
 *   node src/tools/eq-set-type.js                 — показать типы
 *   node src/tools/eq-set-type.js <band> <type>   — сменить
 *     band: 1..4, type: peaking|lowpass|highpass|lowshelf|highshelf
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf'];

/**
 * Прочитать тип полосы band через popup-независимый путь (ValuePattern).
 */
export function readType(band = 1) {
  const raw = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'ComboBoxS1M3') { continue }
  if ($e.Current.AutomationId -notlike '*EqWidgetIem.ComboBoxS1M3') { continue }
  $r = $e.Current.BoundingRectangle
  $p = $null
  $v = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
    $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value
  }
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); val=$v }
}
$out | ConvertTo-Json -Compress -Depth 3
`).trim();
  if (!raw) return null;
  const arr = JSON.parse(raw);
  const list = (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.x - b.x);
  return list[band - 1] ?? null;
}

/**
 * Сменить тип фильтра полосы через popup.
 *
 * @param {number} band 1..4
 * @param {string} typeName
 * @returns {{ok:boolean, band:number, requested:string, applied:string|null, via:string}}
 */
export function setType(band, typeName) {
  if (!TYPES.includes(typeName)) {
    throw new Error(`тип должен быть один из: ${TYPES.join(', ')}`);
  }
  const target = readType(band);
  if (!target) throw new Error(`комбобокс полосы ${band} не найден (окно EQ открыто?)`);

  // 1. развернуть список
  ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${target.i})
$p = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {
  Write-Output "NO_EXPAND"; exit 1
}
([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()
Write-Output "EXPANDED"
`);

  // 2. найти пункт в popup и нажать его (Invoke, иначе Select).
  //    ВАЖНО: popup — ОТДЕЛЬНОЕ top-level окно класса QComboBoxPrivateContainer,
  //    его нет в дереве главного окна.
  const res = ps(PRELUDE + String.raw`
$popupCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'QComboBoxPrivateContainer')
$popup = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children, $popupCond)
if ($null -eq $popup) { Write-Output "NO_POPUP"; exit 1 }

$items = $popup.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)
$done = $false
for ($k = 0; $k -lt $items.Count; $k++) {
  $it = $items.Item($k)
  if ($it.Current.Name -ne '${typeName.replace(/'/g, "''")}') { continue }

  $ip = $null
  if ($it.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
    ([System.Windows.Automation.InvokePattern]$ip).Invoke()
    Write-Output ("INVOKED " + $it.Current.Name)
    $done = $true
    break
  }
  $sp = $null
  if ($it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) {
    ([System.Windows.Automation.SelectionItemPattern]$sp).Select()
    Write-Output ("SELECTED " + $it.Current.Name)
    $done = $true
    break
  }
}
if (-not $done) { Write-Output "ITEM_NOT_FOUND" }
`).trim();

  const via = res.includes('INVOKED') ? 'InvokePattern'
    : res.includes('SELECTED') ? 'SelectionItemPattern'
      : res.includes('NO_POPUP') ? 'no-popup'
        : 'item-not-found';

  return { band, requested: typeName, result: res, via, applied: null };
}

// ---------- CLI ----------
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const bandArg = process.argv[2];
  const typeArg = process.argv[3];

  const eq = readEqSwitch('IN1');
  console.log('EQ IN1 включён:', eq.enabled);

  if (!bandArg) {
    console.log('\nтекущие типы фильтров:');
    for (let b = 1; b <= 4; b++) {
      const t = readType(b);
      console.log(`  полоса ${b}: ${t?.val ?? '?'}  (idx ${t?.i})`);
    }
    console.log(`\nдоступные типы: ${TYPES.join(', ')}`);
    console.log('использование: node src/tools/eq-set-type.js <band> <type>');
    process.exit(0);
  }

  const band = Number(bandArg);
  const before = readType(band);
  console.log(`\nполоса ${band}: было "${before?.val}"`);
  console.log(`меняем на "${typeArg}" через popup...`);

  const r = setType(band, typeArg);
  console.log(`  via=${r.via}  raw="${r.result}"`);
  await sleep(1800);

  const after = readType(band);
  console.log(`  стало: "${after?.val}"`);

  const ws = readWorkspace(findActiveWorkspace().path);
  const raw = ws.EQ_IN1?.[`Eq%40${band}`];
  console.log(`  файл:  ${raw}`);

  const ok = after?.val === typeArg;
  console.log(ok ? '\nУСПЕХ: тип изменён' : '\nНЕУДАЧА: тип не изменился');
  process.exit(ok ? 0 : 1);
}
