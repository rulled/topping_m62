/**
 * Полный разбор переключения реверба.
 * Нажимаем кнопку [402] несколько раз и смотрим все типы.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fx = () => {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    reverbType: i.Effect_Integration?.ReverbType,
    dryWet: {
      studio: i.Effect_Integration?.DryWetStudio,
      live: i.Effect_Integration?.DryWetLive,
      hall: i.Effect_Integration?.DryWetHall,
    },
    level: {
      studio: i.Effect_Integration?.ReverbStudio,
      live: i.Effect_Integration?.ReverbLive,
      hall: i.Effect_Integration?.ReverbHall,
    },
  };
};

function clickAt(lx, ly) {
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
    '  ([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p).Invoke()',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// правильная версия clickAt
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
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK " + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

console.log('исходное:', JSON.stringify(fx()));

// нажимаем кнопку переключения реверба (1022,1636) несколько раз
console.log('\nцикл переключения реверба (кнопка 1022,1636):');
for (let i = 0; i < 5; i++) {
  const r = click(1022, 1636);
  await sleep(1300);
  const s = fx();
  console.log(`  ${i + 1}: ${r.padEnd(8)} reverbType = ${s.reverbType}`);
}
