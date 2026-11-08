/**
 * Проверка HSlider (фейдер входа) -> файл.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = findActiveWorkspace();

function grab() {
  const ini = readWorkspace(ws.path);
  return { in1: ini.Input_IN1?.GAIN, in2: ini.Input_IN2?.GAIN, mixA: ini.Mixer_IN12?.MixA_GAIN };
}

console.log('ДО:', JSON.stringify(grab()));

// HSlider [288] — фейдер IN1
for (const idx of [288, 305]) {
  const r = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  $rv = [System.Windows.Automation.RangeValuePattern]$p
  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum + "|" + $rv.Current.Maximum + "|" + $rv.Current.IsReadOnly)
} else { Write-Output "NORANGE" }
`).trim();
  console.log(`[${idx}] range=${r}`);
}

// попробуем изменить [288]
console.log('\nставлю [288] = 33');
console.log('  ' + ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(288)
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  $rv = [System.Windows.Automation.RangeValuePattern]$p
  $rv.SetValue(33)
  Start-Sleep -Milliseconds 400
  Write-Output ("SET=" + $rv.Current.Value)
} else { Write-Output "NORANGE" }
`).trim());

await sleep(2200);
console.log('ПОСЛЕ:', JSON.stringify(grab()));
