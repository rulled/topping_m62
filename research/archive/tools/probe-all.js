/**
 * Пакетная проверка: для каждого слайдера — меняем значение и смотрим diff
 * состояния через ANNOUNCE.
 *
 * Цель: найти, какие слайдеры вообще вызывают РЕАКЦИЮ в HID-потоке,
 * и какой тег при этом меняется. Метры отфильтровываются.
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const PS_EXE = 'powershell.exe';

const LIST_PS = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $pat=$null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) {
    if ($e.Current.ClassName -ne 'QSlider') { continue }
    $rv = [System.Windows.Automation.RangeValuePattern]$pat
    if ($rv.Current.IsReadOnly) { continue }
    $r = $e.Current.BoundingRectangle
    $out += [pscustomobject]@{idx=$i; val=$rv.Current.Value; min=$rv.Current.Minimum; max=$rv.Current.Maximum; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2)}
  }
}
$out | ConvertTo-Json -Compress
`;

const SET_PS = (idx, val) => String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$pat = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) { Write-Output "NOPATTERN"; exit 1 }
$rv = [System.Windows.Automation.RangeValuePattern]$pat
$rv.SetValue(${val})
Write-Output ("OK " + $rv.Current.Value)
`;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let capture = null;
const latest = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = `${m.target.toString(16).padStart(2, '0')}:${m.prop.toString(16).padStart(2, '0')}`;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});

async function snap() {
  const s = new Map(latest);
  capture = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(1800);
  capture = null;
  return s;
}

function isMeter(a, b) {
  return typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100 && Math.abs(a - b) < 400;
}

const run = async () => {
  const sliders = JSON.parse(execFileSync(PS_EXE, ['-NoProfile', '-Command', LIST_PS], { encoding: 'utf8' }));
  const list = Array.isArray(sliders) ? sliders : [sliders];
  console.log(`проверяю ${list.length} слайдеров\n`);
  console.log('idx    поз.         диапазон      тег-реакция');
  console.log('-'.repeat(66));

  const results = [];
  for (const s of list) {
    // пробуем два крайних значения
    const lo = s.min, hi = s.max;
    const mid = Math.round((lo + hi) / 2);

    const before = await snap();
    try {
      execFileSync(PS_EXE, ['-NoProfile', '-Command', SET_PS(s.idx, hi)], { encoding: 'utf8' });
    } catch { /* пропускаем */ }
    await sleep(900);
    const after = await snap();

    const reacts = [];
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(k), b = after.get(k);
      if (a === b) continue;
      if (isMeter(a, b)) continue;
      reacts.push(`${k}:${a}->${b}`);
    }

    const pos = `(${s.x},${s.y})`;
    console.log(
      `${String(s.idx).padEnd(6)} ${pos.padEnd(11)} ${String(s.min) + '..' + s.max}`.padEnd(40) +
      (reacts.length ? reacts.join(' ') : 'нет'),
    );
    results.push({ idx: s.idx, x: s.x, y: s.y, min: s.min, max: s.max, reacts });

    // вернуть назад
    try {
      execFileSync(PS_EXE, ['-NoProfile', '-Command', SET_PS(s.idx, Math.round(s.val))], { encoding: 'utf8' });
    } catch { /* пропускаем */ }
    await sleep(500);
  }

  console.log('\n=== ИТОГ ===');
  const hit = results.filter((r) => r.reacts.length);
  console.log(`слайдеров с реакцией: ${hit.length} из ${results.length}`);
  for (const h of hit) {
    console.log(`  idx=${h.idx} (${h.x},${h.y}) range=${h.min}..${h.max}  ->  ${h.reacts.join(', ')}`);
  }
  try { dev.close(); } catch { /* уже */ }
  process.exit(0);
};

run();
