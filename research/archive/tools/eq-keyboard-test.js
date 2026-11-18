/**
 * КЛАВИАТУРА НА EQ-ДИЛАХ + ПОЛОСОВЫЕ ЧЕКБОКСЫ.
 *
 * Что проверяем:
 *  1. QCheckBox полосы (y=766) — есть ли TogglePattern (вкл/выкл полосы).
 *  2. Можно ли изменить дил КЛАВИАТУРОЙ: SetFocus + стрелки.
 *     Ранее проверяли только мышь и ValuePattern — клавиатуру НЕ пробовали.
 *     SetValue через ValuePattern бесполезен (значение пустое).
 *
 * БЕЗОПАСНОСТЬ: требует EQ=Off.
 *
 * Запуск: node src/tools/eq-keyboard-test.js
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

/** Все чекбоксы полос + их состояние. */
function bandCheckboxes() {
  const raw = ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'QCheckBox') { continue }
  $aid = $e.Current.AutomationId
  if ($aid -notlike '*EqWidgetIem*') { continue }
  $r = $e.Current.BoundingRectangle
  $pat = $null
  $tg = 'NO_TOGGLE'
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $tg = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); toggle=$tg }
}
$out | ConvertTo-Json -Compress -Depth 3
`);
  if (!raw) return [];
  const arr = JSON.parse(raw);
  return (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.x - b.x);
}

/** Индексы дилов, сгруппированные по полосе. */
function dialIndexByBandParam() {
  const list = JSON.parse(ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'DialS1M5') { continue }
  if ($e.Current.AutomationId -notlike '*.EqWidgetIem.DialS1M5') { continue }
  $r = $e.Current.BoundingRectangle
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2) }
}
$out | ConvertTo-Json -Compress -Depth 3
`));
  const arr = Array.isArray(list) ? list : [list];
  const xs = [...new Set(arr.map((d) => d.x))].sort((a, b) => a - b);
  const rows = { gain: 564, freq: 642, q: 720 };
  const map = {};
  for (const x of xs) {
    const band = xs.indexOf(x) + 1;
    map[band] = {};
    for (const [param, y] of Object.entries(rows)) {
      const hit = arr.find((d) => d.x === x && Math.abs(d.y - y) < 12);
      if (hit) map[band][param] = hit.i;
    }
  }
  return map;
}

function setFocusAndKey(idx, key, times) {
  const SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$e.SetFocus()
Write-Output ("focused=" + $e.Current.ClassName)
Start-Sleep -Milliseconds 250
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 120
}
Write-Output "keys_sent"
`;
  return ps(SCRIPT).trim();
}

function fileBands() {
  const ws = readWorkspace(findActiveWorkspace().path);
  const out = {};
  for (const [k, v] of Object.entries(ws.EQ_IN1 ?? {})) {
    if (/^Eq%40/.test(k)) out[k] = v;
  }
  return out;
}

// --- предохранитель ---
const eq = readEqSwitch('IN1');
console.log('EQ IN1:', JSON.stringify(eq));
if (eq.enabled) {
  console.log('ОТКАЗ: сначала выключите EQ (node src/tools/eq-off.js).');
  process.exit(1);
}
console.log('EQ выключен — безопасно.\n');

console.log('=== ЧЕКБОКСЫ ПОЛОС ===');
const boxes = bandCheckboxes();
for (const b of boxes) console.log(`  [${b.i}] (${b.x},${b.y}) toggle=${b.toggle}`);

console.log('\n=== ДИЛЫ ПО ПОЛОСАМ ===');
const dials = dialIndexByBandParam();
console.log(JSON.stringify(dials, null, 2));

console.log('\n=== ФАЙЛ ДО ===');
console.log(JSON.stringify(fileBands(), null, 2));

// тест: клавиатура на Gain полосы 1
const target = dials[1]?.gain;
if (target === undefined) {
  console.log('дил Gain полосы 1 не найден');
  process.exit(1);
}
console.log(`\n=== КЛАВИАТУРА: дил [${target}] (Gain полосы 1), 5x UP ===`);
const res = setFocusAndKey(target, 'UP', 5);
console.log(res);
await sleep(2500);

console.log('\n=== ФАЙЛ ПОСЛЕ ===');
const after = fileBands();
console.log(JSON.stringify(after, null, 2));
