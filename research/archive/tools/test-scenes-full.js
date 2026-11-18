/**
 * ПОЛНЫЙ СНИМОК СЦЕН: что меняется при нажатии Chat и Vocal.
 *
 * Диффим ВЕСЬ файл и все HID-теги до/после каждого нажатия.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

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

async function snapHid(ms = 2500) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

function snapFile() {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path);
}

function diffFile(a, b) {
  const out = [];
  for (const sec of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = a[sec] ?? {}, sb = b[sec] ?? {};
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (String(sa[k]) !== String(sb[k])) out.push(`${sec}.${k}: ${sa[k]} -> ${sb[k]}`);
    }
  }
  return out;
}

function diffHid(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k), y = b.get(k);
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number' && x < -100 && y < -100) continue; // метры
    out.push(`0x${k.toString(16).padStart(4, '0')}: ${x} -> ${y}`);
  }
  return out;
}

function clickScene(name) {
  const { items } = dumpTree();
  const btn = items.find((x) => (x.name || '').trim() === name);
  if (!btn) return `"${name}" не найдена`;
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
    '$e = $all.Item(' + btn.i + ')', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

for (const scene of ['Chat', 'Vocal', 'Chat']) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`СЦЕНА: ${scene}`);
  console.log('='.repeat(60));

  const f0 = snapFile();
  const h0 = await snapHid();

  console.log(`нажимаю "${scene}": ${clickScene(scene)}`);
  await sleep(2500);

  const f1 = snapFile();
  const h1 = await snapHid();

  const df = diffFile(f0, f1);
  const dh = diffHid(h0, h1);

  console.log(`\nфайл (${df.length}):`);
  if (!df.length) console.log('  нет изменений');
  for (const l of df) console.log(`  ${l}`);

  console.log(`\nHID (${dh.length}):`);
  if (!dh.length) console.log('  нет изменений');
  for (const l of dh) console.log(`  ${l}`);
}

dev.close();
process.exit(0);
