/**
 * Как MCC включает реверб? Ищем кнопку/селектор типа реверба в UI.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reverb = () => {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    type: i.Effect_Integration?.ReverbType,
    muteFX: i.Effect_Integration?.MuteFX,
    dryWet: i.Effect_Integration?.DryWetStudio,
    level: i.Effect_Integration?.ReverbStudio,
  };
};

console.log('реверб сейчас:', JSON.stringify(reverb()));

// ищем ComboBox в панели эффектов
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = $e.Current.ClassName',
  '  if ($cls -notmatch "ComboBox|QPushButton|QToolButton") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cx -lt 850 -or $cx -gt 1250) { continue }',
  '  if ($cy -lt 900 -or $cy -gt 1400) { continue }',
  '  $n = $e.Current.Name',
  '  $p = $null',
  '  $v = ""',
  '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
  '  $res += [pscustomobject]@{ i=$i; cls=$cls; x=$cx; y=$cy; n=$n; v=$v }',
  '}',
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

try {
  const arr = JSON.parse(ps(RAW));
  const list = Array.isArray(arr) ? arr : [arr];
  console.log(`\nэлементы панели FX (${list.length}):`);
  for (const e of list.sort((a, b) => a.y - b.y || a.x - b.x)) {
    console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(16)} (${String(e.x).padStart(4)},${String(e.y).padStart(4)}) "${(e.n || '').replace(/\n/g, '/')}" v="${e.v || ''}"`);
  }
} catch (e) {
  console.log('не удалось:', e.message);
}
