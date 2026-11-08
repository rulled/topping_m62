/**
 * Перебор кнопок входа по КООРДИНАТАМ (индексы UIA нестабильны).
 *
 * Находим кнопку по позиции, нажимаем, смотрим тег, возвращаем обратно.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function snap(ms = 2400) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

/** Нажать кнопку по координатам (ищет свежий индекс). */
function clickAt(lx, ly) {
  return ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$best = -1; $bestD = 1e9
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'QPushButton') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cx = $r.X + $r.Width/2; $cy = $r.Y + $r.Height/2
  $d = [Math]::Abs($cx - ${lx}) + [Math]::Abs($cy - ${ly})
  if ($d -lt $bestD) { $bestD = $d; $best = $i }
}
if ($best -lt 0 -or $bestD -gt 60) { Write-Output "NOTFOUND"; exit 1 }
$e = $all.Item($best)
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.InvokePattern]$pat).Invoke()
  Write-Output ("OK idx=" + $best + " d=" + [int]$bestD)
} else { Write-Output "NOPATTERN" }
`).trim();
}

// координаты кнопок входа IN1 (x=212) и IN2 (x=484)
const TARGETS = [
  { name: 'IN1 @418', x: 212, y: 418 },
  { name: 'IN1 @471', x: 212, y: 471 },
  { name: 'IN1 @523', x: 212, y: 523 },
  { name: 'IN2 @418', x: 484, y: 418 },
  { name: 'IN2 @471', x: 484, y: 471 },
  { name: 'IN2 @523', x: 484, y: 523 },
];

for (const t of TARGETS) {
  const before = await snap();
  const r = clickAt(t.x, t.y);
  await sleep(1200);
  const after = await snap();

  const changed = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k), v = after.get(k);
    if (a === v) continue;
    if (typeof a === 'number' && typeof v === 'number' && a < -100 && v < -100) continue;
    changed.push(`0x${k.toString(16)}: ${a}->${v}`);
  }
  console.log(`${t.name.padEnd(10)} ${r.padEnd(22)} ${changed.length ? changed.join(', ') : '—'}`);
  // вернуть
  clickAt(t.x, t.y);
  await sleep(600);
}

dev.close();
process.exit(0);
