/**
 * ТАЙМИНГ ЗАПИСИ ФАЙЛА ПОСЛЕ НАЖАТИЯ.
 *
 * Гипотеза: MCC пишет workspace-файл с задержкой (debounce), поэтому
 * чтение сразу после нажатия даёт УСТАРЕВШЕЕ значение. Из-за этого
 * лестница Q в eq-ladder.js получилась рваной (3.5527 повторялось 7 раз),
 * а после 24x DOWN Q стал 0.2441 — ниже заявленного минимума 0.707.
 *
 * Проверяем: одно нажатие -> читаем файл каждые 150 мс 5 секунд.
 *
 * Запуск: node src/tools/eq-file-timing.js [param]
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const PARAM = process.argv[2] ?? 'gain';
const ROWS = { gain: 564, freq: 642, q: 720 };
const BAND = 1;

function bandRaw() {
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
  return arr.find((d) => d.x === xs[band - 1] && Math.abs(d.y - ROWS[param]) < 12)?.i;
}

function pressOnce(idx, key) {
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
[System.Windows.Forms.SendKeys]::SendWait("{${key}}")
Write-Output "ok"
`).trim();
}

const eq = readEqSwitch('IN1');
if (eq.enabled) { console.log('ОТКАЗ: EQ включён'); process.exit(1); }

const idx = dialIndexOf(BAND, PARAM);
if (idx === undefined) { console.log('дил не найден'); process.exit(1); }

console.log(`EQ выключен. Полоса ${BAND}, ${PARAM}, дил [${idx}].\n`);
const t0raw = bandRaw();
console.log(`файл до: ${t0raw}`);
const t0 = Date.now();

await pressOnce(idx, 'UP');
console.log('\nнажатие отправлено, следим за файлом:\n');

let last = t0raw;
for (let i = 0; i < 40; i++) {
  await sleep(150);
  const cur = bandRaw();
  const ms = Date.now() - t0;
  if (cur !== last) {
    console.log(`  +${String(ms).padStart(4)} мс  ИЗМЕНИЛСЯ: ${cur}`);
    last = cur;
  }
}
console.log(`\nчерез ${((Date.now() - t0) / 1000).toFixed(1)} с: ${bandRaw()}`);

// вернуть
console.log('\nобратное нажатие:');
const t1 = Date.now();
await pressOnce(idx, 'DOWN');
let last2 = bandRaw();
for (let i = 0; i < 40; i++) {
  await sleep(150);
  const cur = bandRaw();
  if (cur !== last2) {
    console.log(`  +${String(Date.now() - t1).padStart(4)} мс  ИЗМЕНИЛСЯ: ${cur}`);
    last2 = cur;
  }
}
console.log(`итог: ${bandRaw()}`);
