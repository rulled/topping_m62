/**
 * Что переключает кнопка? Сравниваем ВЕСЬ файл до и после нажатия.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fullSnapshot() {
  const ws = findActiveWorkspace();
  return JSON.parse(JSON.stringify(readWorkspace(ws.path)));
}

function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = Get-MccAll $root',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
    '  $d = [Math]::Abs($cx - ' + lx + ') + [Math]::Abs($cy - ' + ly + ')',
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output ("NF"); exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK " + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

function diff(a, b) {
  const out = [];
  for (const sec of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = a[sec] ?? {};
    const sb = b[sec] ?? {};
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (sa[k] !== sb[k]) out.push(`${sec}.${k}: ${sa[k]} -> ${sb[k]}`);
    }
  }
  return out;
}

const CANDIDATES = [
  { x: 371 === 371 ? 494 : 0, y: 1637, name: '[371]' },
  { x: 1242, y: 1637, name: '[410]' },
];

for (const c of CANDIDATES) {
  const before = fullSnapshot();
  const r = clickAt(c.x, c.y);
  await sleep(2000);
  const after = fullSnapshot();
  const d = diff(before, after);
  console.log(`\n=== ${c.name} (${c.x},${c.y}) ${r} ===`);
  if (!d.length) console.log('  нет изменений в файле');
  else for (const line of d) console.log(`  ${line}`);
  // вернуть
  clickAt(c.x, c.y);
  await sleep(1200);
}
