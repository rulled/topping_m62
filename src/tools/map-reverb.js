/**
 * Полная карта управления ревербом: как достичь каждого из 4 типов.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rt = () => {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path).Effect_Integration?.ReverbType;
};

function click(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
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
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output "NF"; exit 0 }',
    '$e = $all.Item($best)', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output ("OK " + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

console.log('текущий тип:', rt());
console.log('\n=== перебор всех кнопок панели FX ===');
console.log('ищем те, что меняют ReverbType\n');

const CANDIDATES = [
  { x: 1022, y: 1472, n: '[399]' },
  { x: 1022, y: 1527, n: '[400]' },
  { x: 1022, y: 1581, n: '[401]' },
  { x: 1022, y: 1636, n: '[402]' },
];

for (const c of CANDIDATES) {
  const before = rt();
  const r = click(c.x, c.y);
  await sleep(1300);
  const after = rt();
  console.log(`${c.n} (${c.x},${c.y}) ${r.padEnd(8)} ${before} -> ${after}${before !== after ? '   <<< меняет' : ''}`);
}

console.log('\n=== полный перебор всех 4 типов через [402] ===');
console.log(`старт: ${rt()}`);
const seen = new Set([rt()]);
for (let i = 0; i < 8; i++) {
  click(1022, 1636);
  await sleep(1200);
  const v = rt();
  seen.add(v);
  console.log(`  ${i + 1}: ${v}`);
  if (seen.size >= 4 && i > 3) break;
}
console.log(`\nвстречено типов: ${seen.size} -> ${[...seen].join(', ')}`);
