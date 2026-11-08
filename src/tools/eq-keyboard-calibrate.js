/**
 * КАЛИБРОВКА КЛАВИАТУРЫ НА EQ-ДИЛАХ.
 *
 * Обнаружено (eq-keyboard-test.js): после SetFocus + стрелок файл EQ_IN1
 * ПЕРЕЗАПИСАЛСЯ и сменил формат на 5-польный (тип|gain|частота|Q|флаг).
 * При этом значения изменились не только у Gain — значит либо SetFocus
 * заставляет MCC сбросить состояние дила в файл, либо стрелки крутят
 * не тот параметр, либо файл был устаревшим и MCC записал своё истинное.
 *
 * Эта утилита делает пошаговую калибровку:
 *   для каждого параметра (gain/freq/q) и каждого направления (UP/DOWN):
 *     - снять файл
 *     - послать K нажатий
 *     - снять файл
 *     - вывести дельту
 *
 * БЕЗОПАСНОСТЬ: требует EQ=Off.
 * Запуск: node src/tools/eq-keyboard-calibrate.js [K]
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();
const K = Number(process.argv[2] ?? 3);

/** Разобрать строку полосы в объект (авто-формат по числу полей). */
function parseBand(raw) {
  if (!raw) return null;
  const parts = String(raw).split('|');
  if (parts.length >= 5) {
    // тип|gain|частота|Q|флаг
    return {
      fmt: 'in',
      type: Number(parts[0]),
      gain: Number(parts[1]),
      freq: Number(parts[2]),
      q: Number(parts[3]),
      flag: Number(parts[4]),
    };
  }
  if (parts.length === 4) {
    // |тип|частота|Q|gain  (ведущий пустой)
    return {
      fmt: 'hp',
      type: Number(parts[1]),
      gain: Number(parts[3]),
      freq: Number(parts[2]),
      q: Number(parts[3]),
      flag: null,
    };
  }
  return { fmt: '?', raw };
}

/** Разобрать корректно оба формата. */
function parseBandSafe(raw) {
  if (!raw) return null;
  const s = String(raw);
  const parts = s.split('|');
  // 5 полей: тип|gain|freq|Q|flag
  if (parts.length === 5) {
    return { fmt: '5', type: +parts[0], gain: +parts[1], freq: +parts[2], q: +parts[3], flag: +parts[4] };
  }
  // 5 частей при ведущем '|': "|0|632|0.7|0" -> ['', '0','632','0.7','0']
  if (parts.length === 5 && parts[0] === '') {
    return { fmt: '4', type: +parts[1], freq: +parts[2], q: +parts[3], gain: +parts[4], flag: null };
  }
  // 4 части: ['', '0', '632', '0.7'] — нет gain
  if (parts.length === 4) {
    return { fmt: '4', type: +parts[1], freq: +parts[2], q: +parts[3], gain: null, flag: null };
  }
  return { raw: s };
}

function band1() {
  const ws = readWorkspace(findActiveWorkspace().path);
  return ws.EQ_IN1?.['Eq%401'] ?? null;
}

function bandsAll() {
  const ws = readWorkspace(findActiveWorkspace().path);
  const out = {};
  for (const k of ['Eq%401', 'Eq%402', 'Eq%403', 'Eq%404']) out[k] = ws.EQ_IN1?.[k] ?? null;
  return out;
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
  const x = xs[band - 1];
  const y = { gain: 564, freq: 642, q: 720 }[param];
  const hit = arr.find((d) => d.x === x && Math.abs(d.y - y) < 12);
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
Start-Sleep -Milliseconds 200
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 130
}
Write-Output "ok"
`).trim();
}

// --- предохранитель ---
const eq = readEqSwitch('IN1');
if (eq.enabled) {
  console.log('ОТКАЗ: EQ включён. Выключите: node src/tools/eq-off.js');
  process.exit(1);
}
console.log(`EQ выключен. Калибровка по ${K} нажатия на параметр.\n`);

const before = bandsAll();
console.log('ВСЕ ПОЛОСЫ ДО:', JSON.stringify(before, null, 2));
console.log('  полоса 1 разбор:', JSON.stringify(parseBandSafe(before['Eq%401'])));

const results = [];
for (const param of ['gain', 'freq', 'q']) {
  const idx = dialIndexOf(1, param);
  if (idx === undefined) { console.log(`дил ${param} не найден`); continue; }

  for (const key of ['UP', 'DOWN']) {
    const b = parseBandSafe(band1());
    await pressKeys(idx, key, K);
    await sleep(1400);
    const a = parseBandSafe(band1());
    const row = { param, key, idx, before: b, after: a };
    if (b && a && b.fmt === a.fmt && 'gain' in a) {
      row.dGain = +(a.gain - b.gain).toFixed(3);
      row.dFreq = +(a.freq - b.freq).toFixed(3);
      row.dQ = +(a.q - b.q).toFixed(4);
    }
    results.push(row);
    console.log(`\n${param} ${key} x${K} (дил [${idx}]):`);
    console.log(`  до:    ${JSON.stringify(b)}`);
    console.log(`  после: ${JSON.stringify(a)}`);
    if ('dGain' in row) console.log(`  Δ: gain=${row.dGain} freq=${row.dFreq} q=${row.dQ}`);
  }
}

console.log('\n\n=== ИТОГОВАЯ ТАБЛИЦА ===');
console.log('param  key   dGain    dFreq     dQ');
for (const r of results) {
  console.log(`${r.param.padEnd(6)} ${r.key.padEnd(5)} ${String(r.dGain ?? '-').padStart(8)} ${String(r.dFreq ?? '-').padStart(9)} ${String(r.dQ ?? '-').padStart(8)}`);
}

console.log('\nВСЕ ПОЛОСЫ ПОСЛЕ:', JSON.stringify(bandsAll(), null, 2));
