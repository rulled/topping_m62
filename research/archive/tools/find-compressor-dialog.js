/** Ищем контейнер панели компрессора и его свойства. */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = $e.Current.ClassName',
  '  if ($cls -notmatch "Compressor|Effect|FieldEffect|Chart") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  $kinds = @()',
  '  $p = $null',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $kinds += "Invoke" }',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $kinds += "Expand" }',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $kinds += "Range" }',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $kinds += "Value" }',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$p)) { $kinds += "Legacy" }',
  '  $res += [pscustomobject]@{ i=$i; cls=$cls; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); w=[int]$r.Width; h=[int]$r.Height; kinds=($kinds -join ",") }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

const arr = JSON.parse(ps(RAW));
const list = Array.isArray(arr) ? arr : [arr];
console.log(`контейнеров/графиков: ${list.length}\n`);
for (const e of list) {
  console.log(`[${String(e.i).padStart(3)}] ${e.cls.padEnd(20)} (${e.x},${e.y}) ${e.w}x${e.h}  [${e.kinds}]`);
}

// что в области графика компрессора (756,1114)
console.log('\n=== элементы в области графика компрессора ===');
const RAW2 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cx -lt 600 -or $cx -gt 950) { continue }',
  '  if ($cy -lt 1050 -or $cy -gt 1600) { continue }',
  '  $res += [pscustomobject]@{ i=$i; cls=$e.Current.ClassName; x=$cx; y=$cy; n=$e.Current.Name }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');
try {
  const a2 = JSON.parse(ps(RAW2));
  const l2 = Array.isArray(a2) ? a2 : [a2];
  for (const e of l2.sort((a, b) => a.y - b.y || a.x - b.x)) {
    console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(16)} (${String(e.x).padStart(4)},${String(e.y).padStart(4)}) "${(e.n || '').replace(/\n/g, '/')}"`);
  }
} catch { console.log('  нет данных'); }
