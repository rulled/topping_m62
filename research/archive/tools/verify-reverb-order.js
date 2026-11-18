/**
 * ПРОВЕРКА ПОРЯДКА КНОПОК РЕВЕРБА.
 *
 * В §28 утверждалось: [399]=STUDIO, [400]=LIVE, [401]=HALL, [402]=Bypass
 * (сверху вниз). Проверяем каждую кнопку ОТДЕЛЬНО от текущего состояния.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reverb = () => {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path).Effect_Integration?.ReverbType;
};

function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    `  $d = [Math]::Abs($r.X + $r.Width/2 - ${lx}) + [Math]::Abs($r.Y + $r.Height/2 - ${ly})`,
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output "NF"; exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK" + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// найдём кнопки реверба — они в области x~1022, y 1450..1660
const { items } = dumpTree();
const revBtns = items
  .filter((x) => x.cls === 'QPushButton' && Math.abs(x.lx - 1022) < 30 && x.ly > 1440 && x.ly < 1670)
  .sort((a, b) => a.ly - b.ly);

console.log(`кнопок реверба найдено: ${revBtns.length}`);
for (const b of revBtns) console.log(`  [${b.i}] (${b.lx},${b.ly})`);
console.log(`\nтекущий тип реверба: ${reverb()}\n`);

console.log('=== ПРОВЕРКА КАЖДОЙ КНОПКИ ===\n');
const results = [];
for (const b of revBtns) {
  const before = reverb();
  const r = clickAt(b.lx, b.ly);
  await sleep(1500);
  const after = reverb();
  console.log(`  [${b.i}] (${b.lx},${b.ly}) ${r.padEnd(8)} ${String(before).padEnd(8)} -> ${after}`);
  results.push({ i: b.i, x: b.lx, y: b.ly, before, after });
}

console.log('\n=== КАРТА ===');
for (const r of results) {
  console.log(`  (${r.x},${r.y}) [${r.i}] -> ${r.after}`);
}

// восстановим Bypass
console.log('\nвосстанавливаю Bypass...');
for (const b of revBtns) {
  if (reverb() === 'Bypass') break;
  clickAt(b.lx, b.ly);
  await sleep(1200);
}
console.log(`итоговый тип: ${reverb()}`);
