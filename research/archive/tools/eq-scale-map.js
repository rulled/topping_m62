/**
 * ТОЧНЫЕ ШКАЛЫ EQ ЧЕРЕЗ КЛАВИАТУРУ (с учётом задержки записи файла).
 *
 * Установлено:
 *   - запись файла после нажатия ≈ 650-700 мс -> ждём 900 мс
 *   - Gain линеен ±1 дБ
 *   - Freq и Q нелинейны
 *   - Q уходит за 0.707 (видели 0.2441) -> документированный минимум неверен
 *
 * Полный проход: от текущего значения до упора вверх, потом до упора вниз.
 * Это даёт ТОЧНУЮ лестницу и реальный диапазон.
 *
 * Запуск: node src/tools/eq-scale-map.js [param] [maxSteps]
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const PARAM = process.argv[2] ?? 'freq';
const MAX = Number(process.argv[3] ?? 60);
const BAND = 1;
const ROWS = { gain: 564, freq: 642, q: 720 };
const SETTLE = 900;

function parse(raw) {
  if (!raw) return null;
  const p = String(raw).split('|');
  if (p.length === 5 && p[0] !== '') return { type: +p[0], gain: +p[1], freq: +p[2], q: +p[3], flag: +p[4] };
  if (p.length === 5 && p[0] === '') return { type: +p[1], freq: +p[2], q: +p[3], gain: +p[4], flag: null };
  return { raw: String(raw) };
}
const bandVal = () => parse(readWorkspace(findActiveWorkspace().path).EQ_IN1?.[`Eq%40${BAND}`]);

function dialIndexOf(band, param) {
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
  return arr.find((d) => d.x === xs[band - 1] && Math.abs(d.y - ROWS[param]) < 12)?.i;
}

function press(idx, key, times) {
  return ps(String.raw`
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
Start-Sleep -Milliseconds 200
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 110
}
Write-Output "ok"
`).trim();
}

const eq = readEqSwitch('IN1');
if (eq.enabled) { console.log('ОТКАЗ: EQ включён'); process.exit(1); }

const idx = dialIndexOf(BAND, PARAM);
if (idx === undefined) { console.log('дил не найден'); process.exit(1); }
console.log(`EQ выключен. Полоса ${BAND}, ${PARAM}, дил [${idx}]. Ждём ${SETTLE} мс после нажатий.\n`);

console.log('старт:', JSON.stringify(bandVal()));

async function sweep(key) {
  const seq = [bandVal()?.[PARAM]];
  for (let k = 0; k < MAX; k++) {
    await press(idx, key, 1);
    await sleep(SETTLE);
    const v = bandVal()?.[PARAM];
    seq.push(v);
    if (v === seq[seq.length - 2]) { break; }  // упёрлись
  }
  return seq;
}

console.log(`\n--- вверх (${MAX} макс) ---`);
const up = await sweep('UP');
console.log('значения:', up.join(', '));

console.log(`\n--- вниз ---`);
const down = await sweep('DOWN');
console.log('значения:', down.join(', '));

const allVals = [...up, ...down.slice(1)];
const nums = allVals.filter((v) => typeof v === 'number');
console.log('\n=== ДИАПАЗОН ===');
console.log(`min=${Math.min(...nums)}  max=${Math.max(...nums)}`);
console.log(`уникальных значений в лестнице: ${new Set(nums).size}`);

if (PARAM === 'freq') {
  console.log('\n=== ПРОВЕРКА ЛОГАРИФМИЧНОСТИ (freq) ===');
  const u = [...new Set(nums)].sort((a, b) => a - b);
  const ratios = [];
  for (let i = 1; i < u.length; i++) if (u[i - 1] > 0) ratios.push(u[i] / u[i - 1]);
  if (ratios.length) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(`шагов: ${ratios.length}, средний коэффициент: ${avg.toFixed(5)} (${(Math.log2(avg) * 1200).toFixed(1)} центов)`);
    console.log(`разброс коэффициента: ${Math.min(...ratios).toFixed(5)} .. ${Math.max(...ratios).toFixed(5)}`);
  }
  console.log('все уникальные freq:', u.join(', '));
}
if (PARAM === 'q') {
  const u = [...new Set(nums)].sort((a, b) => a - b);
  console.log('\nвсе уникальные Q:', u.join(', '));
}
if (PARAM === 'gain') {
  const u = [...new Set(nums)].sort((a, b) => a - b);
  console.log('\nвсе уникальные gain:', u.join(', '));
  const d = [];
  for (let i = 1; i < u.length; i++) d.push(+(u[i] - u[i - 1]).toFixed(4));
  console.log('дельты:', [...new Set(d)].join(', '));
}

console.log('\nфинал файла:', readWorkspace(findActiveWorkspace().path).EQ_IN1?.[`Eq%40${BAND}`]);
