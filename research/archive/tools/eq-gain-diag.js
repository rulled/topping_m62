/**
 * ПОЧЕМУ GAIN НЕ РЕАГИРУЕТ НА СТРЕЛКИ? (диагностика)
 *
 * Freq и Q меняются клавиатурой, а Gain — нет. Проверяем:
 *  1. Правильный ли индекс у дила Gain (сверяем координаты).
 *  2. Реагирует ли дил Gain на стрелки ВООБЩЕ.
 *  3. Не мешает ли чекбокс полосы (полоса выключена).
 *
 * Запуск: node src/tools/eq-gain-diag.js
 */
import { ps, PRELUDE } from './uia.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bandRaw = (n = 1) => {
  const ws = readWorkspace(findActiveWorkspace().path);
  return ws.EQ_IN1?.[`Eq%40${n}`];
};

const RAW_DIALS = PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'DialS1M5') { continue }
  $aid = $e.Current.AutomationId
  if ($aid -notlike '*EqWidgetIem*') { continue }
  $r = $e.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width/2)
  $cy = [int]($r.Y + $r.Height/2)
  $tail = $aid.Substring([Math]::Max(0, $aid.Length - 45))
  Write-Output ("DIAL i=" + $i + " x=" + $cx + " y=" + $cy + " w=" + [int]$r.Width + " h=" + [int]$r.Height + " aid=..." + $tail)
}
`;

function pressKey(idx, key, times) {
  return ps(PRELUDE + String.raw`
Add-Type -AssemblyName System.Windows.Forms
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$e.SetFocus()
Start-Sleep -Milliseconds 300
$f = [System.Windows.Automation.AutomationElement]::FocusedElement
Write-Output ("FOCUSED cls=" + $f.Current.ClassName + " name='" + $f.Current.Name + "'")
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 140
}
Write-Output "sent"
`);
}

console.log('=== ВСЕ ДИЛЫ EQ ===');
const dialsOut = ps(RAW_DIALS);
console.log(dialsOut);

console.log('\n=== ФАЙЛ ДО ===');
console.log('  Eq%401 =', bandRaw(1));

// Берём дил Gain полосы 1 (x≈849, y≈564)
const gainMatch = dialsOut.split(/\r?\n/).find((l) => {
  const mx = l.match(/x=(\d+) y=(\d+)/);
  return mx && Math.abs(Number(mx[1]) - 850) < 8 && Math.abs(Number(mx[2]) - 564) < 15;
});
console.log('\nдил Gain полосы 1:', gainMatch ?? 'НЕ НАЙДЕН');

const idx = gainMatch ? Number(gainMatch.match(/i=(\d+)/)[1]) : null;
if (idx === null) { console.log('нечего тестировать'); process.exit(1); }

console.log(`\n=== 5x UP на диле [${idx}] ===`);
console.log(await pressKey(idx, 'UP', 5));
await sleep(1600);
console.log('  файл после:', bandRaw(1));

console.log(`\n=== 5x DOWN (возврат) ===`);
console.log(await pressKey(idx, 'DOWN', 5));
await sleep(1600);
console.log('  файл после:', bandRaw(1));
