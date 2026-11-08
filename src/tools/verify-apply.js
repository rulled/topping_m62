/**
 * Проверка: применились ли правки файла после переключения workspace.
 *
 * Смотрим:
 *   1) что в UI (значение слайдера Mix A и GAIN)
 *   2) что в HID
 *   3) что в файле
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) файл
const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`активный: ${ws.mode}/${ws.name}`);
console.log(`  файл: MixA_GAIN=${ini.Mixer_IN12?.MixA_GAIN}, GAIN=${ini.Input_IN1?.GAIN}, 48V=${ini.Input_IN1?.['48V']}`);

// 2) UI: слайдеры
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
  '$res | ConvertTo-Json -Compress -Depth 3',
].join('\n');

const sliders = JSON.parse(ps(RAW));
const list = Array.isArray(sliders) ? sliders : [sliders];
console.log('\nслайдеры микшера (-90..12):');
for (const s of list.filter((x) => x.min === -90 && x.max === 12)) {
  console.log(`  [${s.i}] (${s.x},${s.y}) val=${s.v}`);
}

// 3) HID
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (vp) {
  const dev = new HID.HID(vp.path);
  const seen = new Map();
  let cap = null;
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    const k = (m.target << 8) | m.prop;
    seen.set(k, m.value);
    if (cap) cap.set(k, m.value);
  });
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(3000);
  cap = null;
  dev.close();
  console.log(`\nHID: параметров ${s.size}`);
  console.log(`  0x21:0x04 (IN1 gain) = ${s.get(0x2104) ?? '—'}`);
  console.log(`  0x11:0x18 (счётчик) = ${s.get(0x1118) ?? '—'}`);
}
process.exit(0);
