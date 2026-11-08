/**
 * ТОЧНАЯ ПРОВЕРКА: слайдер UI -> INI-файл.
 *
 * Берём слайдер, который по расположению похож на уровень входа
 * (x~65..324, y~1324), меняем и смотрим файл.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = findActiveWorkspace();
console.log(`workspace: ${ws.path}\n`);

function snapshot() {
  const ini = readWorkspace(ws.path);
  const inp = {};
  for (const [sec, kv] of Object.entries(ini)) {
    if (!/^Input_|^Mixer_|^Loopback_|^Output_|^EQ_/.test(sec)) continue;
    inp[sec] = { ...kv };
  }
  return inp;
}

const before = snapshot();
console.log('до:');
for (const [s, kv] of Object.entries(before)) {
  if (s.startsWith('Input_')) console.log(`  ${s}: GAIN=${kv.GAIN} MUTE=${kv.MUTE} 48V=${kv['48V']}`);
  if (s === 'Mixer_IN12') console.log(`  ${s}: MixA_GAIN=${kv.MixA_GAIN} MixB_GAIN=${kv.MixB_GAIN}`);
}

// меняем слайдер IN1 level
console.log('\nменяю slider[348] (65,1324) -> 6');
console.log('  ' + ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(348)
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  $rv = [System.Windows.Automation.RangeValuePattern]$p
  $rv.SetValue(6)
  Start-Sleep -Milliseconds 400
  Write-Output ("SET=" + $rv.Current.Value)
}
`).trim());

await sleep(2500);

const after = snapshot();
console.log('\nпосле (что изменилось в файле):');
let n = 0;
for (const sec of new Set([...Object.keys(before), ...Object.keys(after)])) {
  const a = before[sec] ?? {};
  const b = after[sec] ?? {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    console.log(`  ${sec}.${k}: ${a[k]} -> ${b[k]}`);
    n++;
  }
}
console.log(n ? `\nФАЙЛ ОБНОВИЛСЯ, изменений: ${n}` : '\nфайл не изменился');
process.exit(0);
