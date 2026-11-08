/**
 * Проверка: меняется ли INI-файл при переключении кнопки входа.
 *
 * 1) запомнить контрольную сумму INI
 * 2) нажать кнопку
 * 3) сохранить workspace (Save preset1 / или Ctrl+S)
 * 4) сравнить INI
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

const INI = String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashIni() {
  try {
    const buf = readFileSync(INI);
    return {
      size: buf.length,
      sha: createHash('sha1').update(buf).digest('hex').slice(0, 12),
      mtime: statSync(INI).mtime.toISOString(),
    };
  } catch (e) {
    return { error: e.message };
  }
}

const before = hashIni();
console.log('INI до:', JSON.stringify(before));

// нажать кнопку 48V IN1 (x=212, y=471)
const r = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$best = -1; $bestD = 1e9
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'QPushButton') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)
  $d = [Math]::Abs($cx - 212) + [Math]::Abs($cy - 471)
  if ($d -lt $bestD) { $bestD = $d; $best = $i }
}
$e = $all.Item($best)
$pat = $null
$st = ''
if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
  $st = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
}
Write-Output ("idx=" + $best + " d=" + [int]$bestD + " state=" + $st)
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.InvokePattern]$pat).Invoke()
  Start-Sleep -Milliseconds 400
  $st2 = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  Write-Output ("после нажатия: " + $st2)
}
`).trim();
console.log('нажатие:', r.replace(/\r?\n/g, ' | '));

await sleep(1200);

// сохранить: найти "Save preset1"
const { items } = dumpTree();
const save = items.find((x) => (x.name || '').trim() === 'Save preset1');
if (save) {
  console.log('сохраняю через Save preset1');
  await invoke(save.i);
  await sleep(2500);
} else {
  console.log('Save preset1 не найдена');
}

const after = hashIni();
console.log('INI после:', JSON.stringify(after));
console.log(before.sha === after.sha ? '\nФАЙЛ НЕ ИЗМЕНИЛСЯ' : '\nФАЙЛ ИЗМЕНИЛСЯ');

// показать Input_IN1
try {
  const text = readFileSync(INI, 'utf8');
  const m = text.match(/\[Input_IN1\]([\s\S]*?)(?=\n\[)/);
  if (m) console.log('\n[Input_IN1]:' + m[1].trimEnd());
} catch { /* ok */ }
