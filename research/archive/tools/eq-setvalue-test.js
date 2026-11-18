/**
 * ПРОВЕРКА: можно ли ПИСАТЬ EQ-параметры через ValuePattern.SetValue?
 *
 * Ранее (NOTES §97) считалось, что у дилов EQ нет ни RangeValue, ни ValuePattern
 * и единственный путь — мышь. Глубокий дамп (eq-window-deep.js) показал
 * pats=[Invoke,Value] — ValuePattern ЕСТЬ. Проверяем, есть ли у него SetValue
 * и меняет ли он значение.
 *
 * БЕЗОПАСНОСТЬ: EQ выключен (Switch=Off), поэтому правка полос не влияет
 * на звук. Всё равно проверим mute HP перед тестом.
 *
 * Запуск: node src/tools/eq-setvalue-test.js
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uiEval(body) {
  return ps(PRELUDE + body).trim();
}

/** Найти индексы дилов полосы band (1..4) и ряда row для окна EQ_IN1. */
function findEqDialIndices() {
  const raw = uiEval(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'DialS1M5') { continue }
  $aid = $e.Current.AutomationId
  if ($aid -notlike '*.EqWidgetIem.DialS1M5') { continue }
  $r = $e.Current.BoundingRectangle
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2) }
}
$out | ConvertTo-Json -Compress -Depth 3
`);
  const arr = JSON.parse(raw);
  const list = Array.isArray(arr) ? arr : [arr];
  return list.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Прочитать ValuePattern.Value дила. */
function readDialValue(idx) {
  return uiEval(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
  $vp = [System.Windows.Automation.ValuePattern]$p
  Write-Output ("VAL=[" + $vp.Current.Value + "] readonly=" + $vp.Current.IsReadOnly)
} else { Write-Output "NO_VALUE_PATTERN" }
`);
}

/** Попробовать записать значение через ValuePattern.SetValue. */
function trySetDialValue(idx, value) {
  return uiEval(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
  $vp = [System.Windows.Automation.ValuePattern]$p
  try {
    $vp.SetValue('${value}')
    Write-Output ("SET_OK now=[" + $vp.Current.Value + "]")
  } catch {
    Write-Output ("SET_FAIL " + $_.Exception.Message)
  }
} else { Write-Output "NO_VALUE_PATTERN" }
`);
}

// --- предохранитель ---
const eq = readEqSwitch('IN1');
console.log('EQ IN1:', JSON.stringify(eq));
if (eq.enabled) {
  console.log('ОТКАЗ: EQ включён — эксперимент может изменить звук. Выключите EQ и повторите.');
  process.exit(1);
}
console.log('EQ выключен — правка полос безопасна.\n');

// --- исходное состояние из файла ---
const ws = readWorkspace(findActiveWorkspace().path);
console.log('файл EQ_IN1:');
for (const [k, v] of Object.entries(ws.EQ_IN1 ?? {})) {
  if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
}

const dials = findEqDialIndices();
console.log(`\nнайдено дилов EQ: ${dials.length}`);
for (const d of dials) console.log(`  [${d.i}] (${d.x},${d.y})`);

console.log('\n=== ЧТЕНИЕ ValuePattern ===');
for (const d of dials) {
  const r = readDialValue(d.i);
  console.log(`  [${d.i}] (${d.x},${d.y}) -> ${r}`);
}

console.log('\n=== ПОПЫТКА ЗАПИСИ ValuePattern.SetValue(3.5) на первый дил Gain ===');
if (dials.length) {
  const target = dials[0];
  const before = readDialValue(target.i);
  const setRes = trySetDialValue(target.i, '3.5');
  console.log(`  до:    ${before}`);
  console.log(`  set:   ${setRes}`);
  await sleep(1200);
  const after = readDialValue(target.i);
  console.log(`  после: ${after}`);

  const ws2 = readWorkspace(findActiveWorkspace().path);
  console.log('\n  файл после эксперимента:');
  for (const [k, v] of Object.entries(ws2.EQ_IN1 ?? {})) {
    if (/^Eq%40/.test(k)) console.log(`    ${k} = ${v}`);
  }
}
