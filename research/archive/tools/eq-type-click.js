/**
 * СМЕНА ТИПА ФИЛЬТРА EQ РЕАЛЬНЫМ КЛИКОМ МЫШИ.
 *
 * Ранее проверено (eq-set-type.js):
 *   - у комбобокса НЕТ SelectionPattern
 *   - ExpandCollapse.Expand() работает, popup открывается
 *   - у пунктов popup ЕСТЬ InvokePattern и SelectionItemPattern
 *   - НО ни Invoke(), ни Select() НЕ ПРИМЕНЯЮТ выбор к модели
 *
 * Значит остаётся реальный клик мышью по пункту popup.
 * Здесь он и реализован, с полным циклом: открыть -> клик -> проверить.
 *
 * DPI: UIA даёт ЛОГИЧЕСКИЕ пиксели, SetCursorPos требует ФИЗИЧЕСКИЕ,
 * поэтому координаты ДЕЛЯТСЯ на масштаб (1.75 на этой машине).
 *
 * Запуск: node src/tools/eq-type-click.js <band> <type>
 */
import { ps, PRELUDE } from './uia.js';
import { readEqSwitch } from '../eq-control.js';
import { readWorkspace, findActiveWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf'];

function scale() {
  const raw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  return Number(raw) || 1.75;
}

/** Прочитать тип полосы (ValuePattern комбобокса). */
function readType(band) {
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
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); val=$v }
}
$out | ConvertTo-Json -Compress -Depth 3
`).trim();
  if (!raw) return null;
  const arr = JSON.parse(raw);
  return (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.x - b.x)[band - 1] ?? null;
}

/** Развернуть комбобокс полосы. */
function expand(band) {
  const c = readType(band);
  if (!c) throw new Error(`комбобокс полосы ${band} не найден`);
  ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${c.i})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()
}
`);
  return c;
}

/** Координаты пункта popup по имени. */
function popupItemPos(typeName) {
  // Пишем КООРДИНАТЫ отдельными строками с префиксом, чтобы не зависеть
  // от формата вывода и переводов строк.
  const raw = ps(PRELUDE + String.raw`
$popupCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'QComboBoxPrivateContainer')
$popup = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children, $popupCond)
if ($null -eq $popup) { Write-Output "NO_POPUP"; exit 0 }
$items = $popup.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)
for ($k = 0; $k -lt $items.Count; $k++) {
  $it = $items.Item($k)
  if ($it.Current.Name -ne '${typeName.replace(/'/g, "''")}') { continue }
  $r = $it.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width/2)
  $cy = [int]($r.Y + $r.Height/2)
  Write-Output "POSX=$cx"
  Write-Output "POSY=$cy"
  exit 0
}
Write-Output "NOT_FOUND"
`).trim();

  if (raw.includes('NO_POPUP')) return { error: 'popup не открыт' };
  if (raw.includes('NOT_FOUND')) return { error: 'пункт не найден' };

  const mx = raw.match(/POSX=(-?\d+)/);
  const my = raw.match(/POSY=(-?\d+)/);
  if (!mx || !my) return { error: `не удалось разобрать координаты: ${JSON.stringify(raw)}` };

  return { lx: Number(mx[1]), ly: Number(my[1]) };
}

/** Физический клик по логическим координатам. */
function clickAt(lx, ly) {
  if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
    throw new Error(`отказ от клика: невалидные координаты (${lx},${ly})`);
  }
  const s = scale();
  const px = Math.round(lx / s);
  const py = Math.round(ly / s);
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0) {
    throw new Error(`отказ от клика: физические координаты невалидны (${px},${py})`);
  }
  ps(String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSEqClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSEqClick]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
[MSEqClick]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MSEqClick]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`);
  return { px, py };
}

// ---- CLI ----
const band = Number(process.argv[2] ?? 1);
const typeName = process.argv[3];

if (!typeName || !TYPES.includes(typeName)) {
  console.log(`использование: node src/tools/eq-type-click.js <1..4> <${TYPES.join('|')}>`);
  process.exit(1);
}

const eq = readEqSwitch('IN1');
console.log('EQ IN1 включён:', eq.enabled, '(для смены типа не важно)');

const before = readType(band);
console.log(`полоса ${band}: было "${before?.val}"`);

console.log('разворачиваю список...');
const combo = expand(band);
await sleep(900);

const pos = popupItemPos(typeName);
if (!pos || pos.error) {
  console.log('не удалось получить пункт popup:', pos?.error ?? 'null');
  process.exit(1);
}
console.log(`пункт "${typeName}" в (${pos.lx},${pos.ly}) логических`);

if (!Number.isFinite(pos.lx) || !Number.isFinite(pos.ly)) {
  console.log('координаты невалидны — отказ от клика');
  process.exit(1);
}

const ph = clickAt(pos.lx, pos.ly);
console.log(`клик в физических (${ph.px},${ph.py})`);
await sleep(1800);

const after = readType(band);
console.log(`стало: "${after?.val}"`);

const ws = readWorkspace(findActiveWorkspace().path);
console.log(`файл:  ${ws.EQ_IN1?.[`Eq%40${band}`]}`);

const ok = after?.val === typeName;
console.log(ok ? '\nУСПЕХ: тип изменён кликом' : '\nНЕУДАЧА: тип не изменился');
process.exit(ok ? 0 : 1);
