/**
 * Проверка результата записи в файл:
 *   - слайдер Mix A в UI (должен быть 5)
 *   - GAIN в UI
 *   - файл
 */
import { ps, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QSlider") { continue }',
  '  $p = $null',
  '  if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { continue }',
  '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); v=$rv.Current.Value; min=$rv.Current.Minimum; max=$rv.Current.Maximum }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const sl = JSON.parse(ps(RAW));
const list = Array.isArray(sl) ? sl : [sl];

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`файл: GAIN=${ini.Input_IN1?.['GAIN']} MixA_GAIN=${ini.Mixer_IN12?.MixA_GAIN} MixA_MUTE=${ini.Mixer_IN12?.MixA_MUTE}`);
console.log('');
console.log('все слайдеры UI:');
for (const s of list) {
  const tag = s.min === -90 && s.max === 12 ? ' [микшер]'
    : s.min === 0 && s.max === 88 ? ' [gain]'
    : s.min === -90 && s.max === 0 ? ' [уровень]' : '';
  console.log(`  [${String(s.i).padStart(3)}] (${String(s.x).padStart(4)},${String(s.y).padStart(4)}) val=${String(s.v).padStart(5)} range=${s.min}..${s.max}${tag}`);
}
