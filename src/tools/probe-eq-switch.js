/**
 * Перебор кнопок нижней панели: ищем включение EQ.
 *
 * После каждого нажатия смотрим EQ_IN1.Switch в файле.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
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

async function snap(ms = 2000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

function switches() {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return {
    eqIn1: ini.EQ_IN1?.Switch,
    eqIn2: ini.EQ_IN2?.Switch,
    eqHp: ini.EQ_HP?.Switch,
    comp: ini.Compressor?.Switch,
    duck: ini.Ducking?.DuckingSwitch,
  };
}

/** Нажать кнопку по координатам (ищет заново). */
function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = Get-MccAll $root',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
    '  $d = [Math]::Abs($cx - ' + lx + ') + [Math]::Abs($cy - ' + ly + ')',
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output ("NF d=" + [int]$bestD); exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK idx=" + $best + " d=" + [int]$bestD)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

const before = switches();
console.log('переключатели ДО:', JSON.stringify(before));

// координаты кнопок в нижней области FX
const CANDIDATES = [
  { x: 494, y: 1637 },
  { x: 758, y: 1637 },
  { x: 1022, y: 1472 },
  { x: 1022, y: 1527 },
  { x: 1022, y: 1581 },
  { x: 1242, y: 1637 },
];

for (const c of CANDIDATES) {
  const r = clickAt(c.x, c.y);
  await sleep(1500);
  const now = switches();
  const changed = Object.entries(now).filter(([k, v]) => before[k] !== v);
  console.log(`(${c.x},${c.y}) ${r.padEnd(18)} ${changed.length ? changed.map(([k, v]) => `${k}=${v}`).join(', ') : '—'}`);
  if (changed.length) {
    await sleep(2000);
    const s = await snap();
    const eq91 = [...Array(10)].map((_, i) => s.get(0x9101 + i) ?? '—').join(' ');
    console.log(`   HID 0x91: ${eq91}`);
    console.log(`   HID 0x9b: ${[...Array(6)].map((_, i) => s.get(0x9b00 | (0x0d + i)) ?? '—').join(' ')}`);
  }
  // вернуть обратно если изменилось
  if (changed.length) { clickAt(c.x, c.y); await sleep(800); }
}

dev.close();
process.exit(0);
