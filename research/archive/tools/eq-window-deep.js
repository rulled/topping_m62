/**
 * ГЛУБОКИЙ РАЗБОР ОКНА EQ.
 *
 * Цель: найти ЛЮБОЙ программный путь записи Gain/Freq/Q/типа фильтра.
 * Ранее (NOTES §97) установлено, что у дилов нет RangeValue/ValuePattern,
 * а Invoke не меняет значение. Но полный дамп с ВСЕМИ паттернами и
 * дочерними элементами мы не делали — возможно, есть спинбоксы,
 * скрытые поля ввода или дочерние Edit-элементы.
 *
 * Запуск: node src/tools/eq-window-deep.js [--no-open]
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scaleOf() {
  const raw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  return Number(raw) || 1.75;
}

/** Найти кнопку EQ для входа (TogglePattern, y≈270). */
function findEqButton(which = 'IN1') {
  const { items } = dumpTree();
  const cols = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 340 && x.ly > 100 && x.ly < 400)
    .sort((a, b) => a.lx - b.lx || a.ly - b.ly);

  const groups = [];
  for (const b of cols) {
    let g = groups.find((c) => Math.abs(c.x - b.lx) < 25);
    if (!g) { g = { x: b.lx, items: [] }; groups.push(g); }
    g.items.push(b);
  }
  groups.sort((a, b) => a.x - b.x);
  const target = groups.find((g) => {
    const eqY = g.items.find((b) => Math.abs(b.ly - 270) < 20);
    return Boolean(eqY) && (which === 'IN2' ? g.x > 200 : g.x < 200);
  });
  if (!target) return null;
  return target.items.find((b) => Math.abs(b.ly - 270) < 20) ?? null;
}

function doubleClick(lx, ly) {
  const scale = scaleOf();
  const px = Math.round(lx / scale);
  const py = Math.round(ly / scale);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSD2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSD2]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 250
[MSD2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSD2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 90
[MSD2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSD2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' }); } catch { /* */ }
}

/** Полный дамп с ВСЕМИ паттернами + числовыми значениями где возможно. */
function dumpFull() {
  const raw = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $r = $e.Current.BoundingRectangle
  $pat = $null
  $kinds = @()
  $val = ''
  $rv = ''
  $tg = ''
  $sel = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $kinds += 'Invoke' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) {
    $kinds += 'Range'
    $rv = "$(([System.Windows.Automation.RangeValuePattern]$pat).Current.Value)|min=$(([System.Windows.Automation.RangeValuePattern]$pat).Current.Minimum)|max=$(([System.Windows.Automation.RangeValuePattern]$pat).Current.Maximum)"
  }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $kinds += 'Toggle'
    $tg = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
    $kinds += 'Value'
    $val = ([System.Windows.Automation.ValuePattern]$pat).Current.Value
  }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pat)) {
    $kinds += 'SelItem'
    $sel = ([System.Windows.Automation.SelectionItemPattern]$pat).Current.IsSelected.ToString()
  }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$pat)) { $kinds += 'Sel' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) { $kinds += 'Exp' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pat)) { $kinds += 'Scroll' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pat)) { $kinds += 'Text' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern, [ref]$pat)) { $kinds += 'GridItem' }
  $out += [pscustomobject]@{
    i = $i
    cls = $e.Current.ClassName
    name = $e.Current.Name
    aid = $e.Current.AutomationId
    ctype = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.',''
    lx = [int]($r.X + $r.Width/2)
    ly = [int]($r.Y + $r.Height/2)
    w = [int]$r.Width
    h = [int]$r.Height
    pats = ($kinds -join ',')
    val = $val
    rv = $rv
    tg = $tg
    sel = $sel
  }
}
$out | ConvertTo-Json -Compress -Depth 3
`);
  const arr = JSON.parse(raw);
  return Array.isArray(arr) ? arr : [arr];
}

const doOpen = !process.argv.includes('--no-open');

let isOpen = dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
console.log('окно EQ открыто до:', isOpen);

if (!isOpen && doOpen) {
  const btn = findEqButton('IN1');
  if (!btn) { console.log('кнопка EQ IN1 не найдена'); process.exit(1); }
  console.log(`кнопка EQ IN1: [${btn.i}] (${btn.lx},${btn.ly}) — двойной клик`);
  doubleClick(btn.lx, btn.ly);
  await sleep(2500);
  isOpen = dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
  console.log('окно EQ открыто после:', isOpen);
}

if (!isOpen) { console.log('окно не открылось, дампа не будет'); process.exit(1); }

const all = dumpFull();
console.log(`\nвсего элементов в дереве: ${all.length}`);

// всё, что хоть как-то связано с EQ
const eqish = all.filter((x) =>
  /Equalizer|ComboBoxS1M3|Dial|Knob|Spin|Edit/i.test(x.cls ?? '')
  || /Equalizer/.test(x.aid ?? '')
  || (x.ly >= 480 && x.ly <= 760 && x.lx >= 660 && x.lx <= 1000)
);

console.log(`\n=== ЭЛЕМЕНТЫ ОБЛАСТИ EQ (${eqish.length}) ===`);
for (const x of eqish.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const extra = [];
  if (x.val) extra.push(`val="${x.val}"`);
  if (x.rv) extra.push(`range=${x.rv}`);
  if (x.tg) extra.push(`toggle=${x.tg}`);
  if (x.sel) extra.push(`selected=${x.sel}`);
  console.log(`[${x.i}] ${x.ctype} cls=${x.cls} name="${x.name}" aid="${x.aid}" (${x.lx},${x.ly}) ${x.w}x${x.h} pats=[${x.pats}] ${extra.join(' ')}`);
}

console.log('\n=== ВСЕ ЭЛЕМЕНТЫ С Range ИЛИ Value В ОКНЕ ===');
const rvAll = all.filter((x) => /Range|Value/.test(x.pats ?? ''));
for (const x of rvAll.sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
  const extra = [];
  if (x.val) extra.push(`val="${x.val}"`);
  if (x.rv) extra.push(`range=${x.rv}`);
  console.log(`[${x.i}] ${x.ctype} cls=${x.cls} name="${x.name}" (${x.lx},${x.ly}) pats=[${x.pats}] ${extra.join(' ')}`);
}
