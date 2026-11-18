/**
 * Поиск числового ввода для компрессора.
 * Смотрим ВСЕ QLineEdit и их значения, ищем связанные с компрессором.
 */
import { ps, PRELUDE } from './uia.js';

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = $e.Current.ClassName',
  '  if ($cls -ne "QLineEdit" -and $cls -ne "QLabel") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  # область панели компрессора: x 600..1300, y 1200..1650',
  '  if ($cx -lt 600 -or $cx -gt 1300) { continue }',
  '  if ($cy -lt 1200 -or $cy -gt 1650) { continue }',
  '  $v = ""',
  '  $p = $null',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
  '  $res += [pscustomobject]@{ i=$i; cls=$cls; x=$cx; y=$cy; n=$e.Current.Name; v=$v }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

const out = ps(RAW);
try {
  const arr = JSON.parse(out || '[]');
  const list = Array.isArray(arr) ? arr : [arr];
  console.log(`элементов в области компрессора: ${list.length}\n`);
  for (const e of list.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const info = e.v ? `v="${e.v}"` : `n="${(e.n || '').replace(/\n/g, '/')}"`;
    console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(10)} (${String(e.x).padStart(4)},${String(e.y).padStart(4)}) ${info}`);
  }
} catch {
  console.log('не удалось разобрать:', out.slice(0, 200));
}
