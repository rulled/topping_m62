/**
 * ПЕРЕПРОВЕРКА МИКШЕРА с исправленным транспортом.
 *
 * Ранее (до фикса бага чтения и DPI) я заключил, что микшер не идёт через HID.
 * Теперь проверяем заново: двигаем фейдер микшера через UIA RangeValue
 * и смотрим ВСЕ события, включая те, что раньше терялись.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

if (args.includes('--list')) {
  const { items } = dumpTree();
  console.log('все слайдеры с диапазоном:');
  const sliders = items.filter((x) => /R/.test(x.pats) && /QSlider/.test(x.cls));
  for (const s of sliders) {
    const info = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${s.i})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  $rv = [System.Windows.Automation.RangeValuePattern]$p
  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum + "|" + $rv.Current.Maximum)
} else { Write-Output "?|?|?" }
`).trim();
    console.log(`  [${String(s.i).padStart(3)}] (${s.lx},${s.ly}) range=${info}`);
  }
  process.exit(0);
}

const idx = Number(arg('idx', '-1'));
const val = arg('value', '6');
if (idx < 0) { console.error('укажи --idx'); process.exit(1); }

// HID
const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
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

async function snap(ms = 3200) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const before = await snap();
console.log(`снимок ДО: ${before.size} параметров`);

console.log(`ставлю slider[${idx}] = ${val}`);
console.log('  ' + ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$p = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  Write-Output "NORANGE"; exit 1
}
$rv = [System.Windows.Automation.RangeValuePattern]$p
$rv.SetValue(${val})
Start-Sleep -Milliseconds 300
Write-Output ("SET=" + $rv.Current.Value)
`).trim());

await sleep(1500);
const after = await snap();
console.log(`снимок ПОСЛЕ: ${after.size} параметров\n`);

console.log('=== ИЗМЕНЕНИЯ ===');
let n = 0;
for (const k of new Set([...before.keys(), ...after.keys()])) {
  const a = before.get(k), b = after.get(k);
  if (a === b) continue;
  const isMeter = typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100;
  if (isMeter) continue;
  console.log(`  0x${k.toString(16).padStart(4, '0')}  ${a} -> ${b}   <<<`);
  n++;
}
if (!n) console.log('  (нет изменений кроме метров)');
else console.log(`\n  ВСЕГО РЕАКЦИЙ: ${n}`);

// показать также новые теги, появившиеся впервые
const brandNew = [...after.keys()].filter((k) => !before.has(k));
if (brandNew.length) {
  console.log('\nновые теги, появившиеся впервые:');
  for (const k of brandNew) console.log(`  0x${k.toString(16).padStart(4, '0')} = ${after.get(k)}`);
}

dev.close();
process.exit(0);
