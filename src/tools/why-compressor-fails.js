/** Проверка: почему не пишется компрессор. Смотрим секцию целиком. */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log('=== [Compressor] в файле ===');
for (const [k, v] of Object.entries(ini.Compressor ?? {})) {
  console.log(`  ${k} = ${v}`);
}

console.log('\n=== для сравнения: [Ducking] (он пишется) ===');
for (const [k, v] of Object.entries(ini.Ducking ?? {}).slice(0, 10)) {
  console.log(`  ${k} = ${v}`);
}

// возможно, в UI компрессор надо сначала включить/открыть панель
console.log('\n=== состояние UI: есть ли панель компрессора ===');
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLabel") { continue }',
  '  $n = $e.Current.Name',
  '  if (-not $n -or -not $n.Trim()) { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $res += [pscustomobject]@{ x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); n=$n }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
try {
  const arr = JSON.parse(ps(RAW));
  const list = Array.isArray(arr) ? arr : [arr];
  const comp = list.filter((l) => /THRESH|RATIO|ATTACK|RELEASE|Ratio|Threshold|Attack|Release|Mix|Gain/i.test(l.n));
  console.log(`  подписи, похожие на компрессор: ${comp.length}`);
  for (const c of comp.slice(0, 12)) console.log(`    (${c.x},${c.y}) "${c.n.replace(/\n/g, '/')}"`);
} catch (e) {
  console.log('  не удалось:', e.message);
}
