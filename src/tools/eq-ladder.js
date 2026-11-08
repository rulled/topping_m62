/**
 * ИЗМЕРЕНИЕ ЛЕСТНИЦ EQ-ПАРАМЕТРОВ.
 *
 * Клавиатура на дилах EQ работает (eq-keyboard-calibrate.js):
 *   Gain: ±1 дБ за нажатие — ЛИНЕЙНО
 *   Freq: НЕлинейно (логарифмическая шкала)
 *   Q:    НЕлинейно (похоже на дискретную лестницу стандартных Q)
 *
 * Задача: снять ТОЧНЫЕ шаги, чтобы потом считать число нажатий для
 * достижения нужного значения.
 *
 * Метод: зажать клавишу на N шагов и записать получившиеся значения.
 * Каждое нажатие пишется MCC в файл, поэтому лестница читается напрямую.
 *
 * БЕЗОПАСНОСТЬ: требует EQ=Off.
 * Запуск: node src/tools/eq-ladder.js [param] [steps]
 *   param: freq | q | gain
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const PARAM = process.argv[2] ?? 'freq';
const STEPS = Number(process.argv[3] ?? 20);
const BAND = 1;

const ROWS = { gain: 564, freq: 642, q: 720 };

function parse5(raw) {
  if (!raw) return null;
  const p = String(raw).split('|');
  if (p.length === 5 && p[0] !== '') {
    return { type: +p[0], gain: +p[1], freq: +p[2], q: +p[3], flag: +p[4] };
  }
  if (p.length === 5 && p[0] === '') {
    return { type: +p[1], freq: +p[2], q: +p[3], gain: +p[4], flag: null };
  }
  return { raw: String(raw) };
}

function bandValue() {
  const ws = readWorkspace(findActiveWorkspace().path);
  return ws.EQ_IN1?.[`Eq%40${BAND}`] ?? null;
}

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
  const hit = arr.find((d) => d.x === xs[band - 1] && Math.abs(d.y - ROWS[param]) < 12);
  return hit?.i;
}

function pressKeys(idx, key, times) {
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
Start-Sleep -Milliseconds 250
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 130
}
Write-Output "ok"
`).trim();
}

const eq = readEqSwitch('IN1');
if (eq.enabled) { console.log('ОТКАЗ: EQ включён'); process.exit(1); }

const idx = dialIndexOf(BAND, PARAM);
if (idx === undefined) { console.log(`дил ${PARAM} не найден`); process.exit(1); }
console.log(`EQ выключен. Полоса ${BAND}, параметр ${PARAM}, дил [${idx}], ${STEPS} шагов.\n`);

// синхронизация: файл может быть устаревшим относительно памяти MCC.
// UP затем DOWN даёт в сумме ноль, но заставляет MCC записать своё состояние.
await pressKeys(idx, 'UP', 1);
await sleep(700);
await pressKeys(idx, 'DOWN', 1);
await sleep(1200);
const synced = parse5(bandValue());
console.log('после синхронизации (UP1+DOWN1):', JSON.stringify(synced), '\n');

const ladder = [];
let prev = synced;
for (let k = 1; k <= STEPS; k++) {
  await pressKeys(idx, 'UP', 1);
  await sleep(700);
  const cur = parse5(bandValue());
  const step = {};
  for (const f of ['gain', 'freq', 'q']) {
    if (cur && prev && typeof cur[f] === 'number' && typeof prev[f] === 'number') {
      step['d' + f] = +(cur[f] - prev[f]).toFixed(4);
      if (cur[f] !== prev[f]) step['r' + f] = +(cur[f] / prev[f]).toFixed(6);
    }
  }
  ladder.push({ k, val: cur?.[PARAM], all: cur, step });
  console.log(`  ${String(k).padStart(2)}: ${PARAM}=${String(cur?.[PARAM]).padStart(10)}   ${JSON.stringify(step)}`);
  prev = cur;
}

console.log('\n=== ЛЕСТНИЦА (значения) ===');
console.log(ladder.map((x) => x.val).join(', '));

const ratios = ladder.map((x) => x.step['r' + PARAM]).filter((x) => typeof x === 'number');
if (ratios.length) {
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  console.log(`средний коэффициент шага: ${avg.toFixed(6)}  (log2 = ${Math.log2(avg).toFixed(4)} октавы)`);
  const uniq = [...new Set(ratios)];
  console.log(`уникальных коэффициентов: ${uniq.length} -> ${uniq.slice(0, 12).join(', ')}`);
}
const diffs = ladder.map((x) => x.step['d' + PARAM]).filter((x) => typeof x === 'number');
if (diffs.length) {
  const min = Math.min(...diffs); const max = Math.max(...diffs);
  console.log(`дельта шага: min=${min} max=${max} (${min === max ? 'ЛИНЕЙНО' : 'нелинейно'})`);
}

// вернуть на место: столько же DOWN
console.log(`\nвозврат: ${STEPS}x DOWN`);
await pressKeys(idx, 'DOWN', STEPS);
await sleep(1200);
console.log('итог:', bandValue());
