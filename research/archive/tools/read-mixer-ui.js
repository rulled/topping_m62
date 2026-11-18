/**
 * Прочитать значения слайдеров микшера из UI MCC.
 * Используется для проверки, применилось ли изменение на устройстве.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

/** Все слайдеры микшера: индекс -> { i, x, y, value } */
export function mixerSliders() {
  const { items } = dumpTree();
  const sliders = items
    .filter((x) => x.cls === 'QSlider' && x.ly > 450 && x.ly < 620 && x.lx > 1100)
    .sort((a, b) => a.lx - b.lx);

  const out = [];
  for (const s of sliders) {
    const RAW = PRELUDE + [
      '$root = Get-MccRoot',
      '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
      `$e = $all.Item(${s.i})`,
      '$p = $null',
      'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
      '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
      '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
      '} else { Write-Output "NOPATTERN" }',
    ].join('\n');
    const r = ps(RAW).trim();
    if (r === 'NOPATTERN') continue;
    const [v, mn, mx] = r.split('|').map(Number);
    out.push({ i: s.i, x: s.lx, y: s.ly, value: v, min: mn, max: mx });
  }
  return out;
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const sl = mixerSliders();
  console.log(`слайдеров микшера: ${sl.length}\n`);
  const NAMES = ['Mix A', 'Mix B', 'Mix C', 'Mix D', 'Mix E',
    'FX A', 'FX B', 'FX C', 'FX D', 'FX E'];
  sl.forEach((s, idx) => {
    const nm = NAMES[idx] ?? `#${idx}`;
    console.log(`  [${String(s.i).padStart(3)}] (${String(s.x).padStart(4)},${s.y}) ${nm.padEnd(8)} = ${String(s.value).padStart(4)}  (${s.min}..${s.max})`);
  });
}
