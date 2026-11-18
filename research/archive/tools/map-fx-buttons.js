/**
 * ПОЛНАЯ КАРТА КНОПОК ПАНЕЛИ FX.
 *
 * Диффим INI + HID при нажатии каждой кнопки в нижней области.
 * Цель: документировать ВСЕ, а не только найденные ранее.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
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

async function snapHid(ms = 2200) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const snapFile = () => readWorkspace(findActiveWorkspace().path);

function diffFile(a, b) {
  const out = [];
  for (const sec of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = a[sec] ?? {};
    const sb = b[sec] ?? {};
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (String(sa[k]) !== String(sb[k])) out.push(`${sec}.${k}: ${sa[k]} -> ${sb[k]}`);
    }
  }
  return out;
}

function diffHid(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k);
    const y = b.get(k);
    if (x === y) continue;
    const tt = k >> 8;
    // метры шумят — пропускаем
    if (typeof x === 'number' && typeof y === 'number' && x < -100 && y < -100
        && [0x21, 0x25, 0x26, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x39,
            0x44, 0x46, 0x61, 0x62, 0x63, 0x64, 0x9b].includes(tt)) continue;
    out.push(`0x${k.toString(16).padStart(4, '0')}: ${x} -> ${y}`);
  }
  return out;
}

function clickAt(lx, ly) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    `  $d = [Math]::Abs($r.X + $r.Width/2 - ${lx}) + [Math]::Abs($r.Y + $r.Height/2 - ${ly})`,
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    'if ($best -lt 0 -or $bestD -gt 40) { Write-Output "NF"; exit 0 }',
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK" + $best)',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// все кнопки нижней области
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cy -lt 1540) { continue }',
  '  $res += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=$cy; w=[int]$r.Width; h=[int]$r.Height }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');

const btns = JSON.parse(ps(RAW));
const list = (Array.isArray(btns) ? btns : [btns]).sort((a, b) => a.y - b.y || a.x - b.x);

console.log(`кнопок нижней области: ${list.length}\n`);
console.log('координаты    индекс  что меняется');
console.log('-'.repeat(75));

const map = [];
for (const b of list) {
  const f0 = snapFile();
  const h0 = await snapHid();
  const r = clickAt(b.x, b.y);
  await sleep(1100);
  const f1 = snapFile();
  const h1 = await snapHid();

  const df = diffFile(f0, f1);
  const dh = diffHid(h0, h1);
  const changes = [...df, ...dh].filter(Boolean);
  const short = changes.length
    ? changes.map((c) => c.replace(/^.*?\./, '').slice(0, 40)).join(' | ')
    : '—';

  console.log(`(${String(b.x).padStart(4)},${b.y})  ${String(b.i).padStart(4)}  ${short}`);
  map.push({ x: b.x, y: b.y, idx: b.i, changes });

  // вернуть, если что-то изменилось
  if (changes.length) {
    clickAt(b.x, b.y);
    await sleep(600);
  }
}

console.log('\n=== ИТОГ ===');
const active = map.filter((m) => m.changes.length);
console.log(`кнопок с эффектом: ${active.length} из ${map.length}`);
for (const m of active) {
  console.log(`  (${m.x},${m.y}) idx=${m.idx}: ${m.changes.join('; ')}`);
}

dev.close();
process.exit(0);
