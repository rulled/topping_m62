/**
 * Диагностика: какой элемент UI пишет в Input_IN1.GAIN?
 *
 * Перебираем доступные интерактивные элементы, после каждого смотрим,
 * изменился ли GAIN в файле.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = findActiveWorkspace();

function gain() {
  const ini = readWorkspace(ws.path);
  return {
    in1: ini.Input_IN1?.GAIN,
    in2: ini.Input_IN2?.GAIN,
    mixA: ini.Mixer_IN12?.MixA_GAIN,
  };
}

console.log('текущее:', JSON.stringify(gain()));

// найдём dial'ы (крутилки) — GAIN обычно dial
const RAW = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$res = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $c = $e.Current.ClassName
  if ($c -notmatch 'Dial|HSlider') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $res += [pscustomobject]@{ i=$i; c=$c; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2) }
}
$res | ConvertTo-Json -Compress -Depth 3
`);
const arr = JSON.parse(RAW);
const list = Array.isArray(arr) ? arr : [arr];
console.log(`\ndial/slider элементов: ${list.length}`);
for (const d of list) console.log(`  [${d.i}] ${d.c.padEnd(12)} (${d.x},${d.y})`);
