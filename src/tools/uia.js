/**
 * Утилита UI Automation с УЧЁТОМ DPI.
 *
 * На этой машине DPI = 168, то есть масштаб 1.75.
 * UIAutomation возвращает координаты в ЛОГИЧЕСКИХ пикселях,
 * а SetCursorPos / SendInput работают в ФИЗИЧЕСКИХ.
 *
 * Отсюда: все прошлые клики мышью били мимо цели на ~75%.
 * Поэтому клики делаем через UIA Invoke/Toggle (они DPI-независимы),
 * а координаты для мыши пересчитываем делением на масштаб.
 */
import { execFileSync } from 'node:child_process';

export const PS_EXE = 'powershell.exe';

export const PRELUDE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DD {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
}
'@
[DD]::SetProcessDPIAware() | Out-Null
$dc = [DD]::GetDC([IntPtr]::Zero)
$script:dpi = [DD]::GetDeviceCaps($dc, 88)
[DD]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null
$script:scale = $script:dpi / 96.0

function Get-MccRoot {
  # ВАЖНО (найдено 2026-11-07): MainWindowHandle может указывать на
  # QComboBoxPrivateContainer (открытый выпадающий список), а не на
  # настоящее окно. Ищем по классу MainWindow_M62 среди top-level окон.
  $p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
  $tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  for ($i = 0; $i -lt $tops.Count; $i++) {
    $w = $tops.Item($i)
    if ($w.Current.ClassName -eq "MainWindow_M62") { return $w }
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
function Get-MccAll($root) {
  return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                       [System.Windows.Automation.Condition]::TrueCondition)
}
`;

export function ps(cmd, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], {
    encoding: 'utf8', maxBuffer,
  }).trim();
}

/** Полный дамп дерева UI с логическими И физическими координатами. */
export function dumpTree() {
  const raw = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0 -or $r.Width -le 0) { continue }
  $kinds = @()
  $pat = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $kinds += 'I' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) { $kinds += 'R' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) { $kinds += 'T' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) { $kinds += 'V' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pat)) { $kinds += 'S' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) { $kinds += 'E' }
  $out += [pscustomobject]@{
    i = $i
    cls = $e.Current.ClassName
    name = $e.Current.Name
    lx = [int]($r.X + $r.Width/2)
    ly = [int]($r.Y + $r.Height/2)
    w = [int]$r.Width
    h = [int]$r.Height
    pats = ($kinds -join '')
  }
}
Write-Output ("SCALE=" + $script:scale)
$out | ConvertTo-Json -Compress -Depth 3
`);
  const lines = raw.split(/\r?\n/);
  const scaleLine = lines.find((l) => l.startsWith('SCALE='));
  const scale = scaleLine ? Number(scaleLine.split('=')[1]) : 1;
  const json = lines.filter((l) => !l.startsWith('SCALE=')).join('\n');
  const arr = JSON.parse(json);
  const list = Array.isArray(arr) ? arr : [arr];
  return { scale, items: list };
}

/** Нажать элемент по индексу через UIA (DPI-независимо). */
export function invoke(idx) {
  return ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.InvokePattern]$pat).Invoke()
  Write-Output "INVOKED"
} elseif ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.TogglePattern]$pat).Toggle()
  Write-Output "TOGGLED"
} else {
  Write-Output "NOPATTERN"
}
`);
}

/** Установить значение слайдера по индексу. */
export function setRange(idx, value) {
  return ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$pat = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) {
  Write-Output "NORANGE"; exit 1
}
$rv = [System.Windows.Automation.RangeValuePattern]$pat
$rv.SetValue(${value})
Write-Output ("SET=" + $rv.Current.Value)
`);
}
