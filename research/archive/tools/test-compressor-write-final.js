/**
 * Последняя проверка: пишутся ли ЛЮБЫЕ теги компрессора через HID
 * после Load preset, когда они «живые»?
 *
 * Проверяем Attack (0x4604) и Mix (0x4608) — у них шкала 1:1.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

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

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return { att: Number(c.Attack), rel: Number(c.Release), mix: Number(c.Mix), thr: Number(c.Threshold) };
};

console.log('Load preset1...');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(6000);

const refresh = async () => {
  cap = seen;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(2000);
  cap = null;
};

await refresh();
console.log('файл:', JSON.stringify(comp()));
console.log('HID: att=' + seen.get(0x4604) + ' rel=' + seen.get(0x4605) + ' mix=' + seen.get(0x4608) + ' thr=' + seen.get(0x4602));

console.log('\n=== ПРОБУЮ ПИСАТЬ (шкала 1:1) ===\n');
const TESTS = [
  { tag: 0x4604, v: 20, name: 'Attack=20', key: 'att' },
  { tag: 0x4605, v: 500, name: 'Release=500', key: 'rel' },
  { tag: 0x4608, v: 50, name: 'Mix=50', key: 'mix' },
];

for (const t of TESTS) {
  const before = comp()[t.key];
  dev.write([...withReportId(buildFrame(0x46, t.tag & 0xff, t.v, true))]);
  await sleep(1800);
  await refresh();
  const after = comp()[t.key];
  const hidVal = seen.get(t.tag);
  const ok = after === t.v;
  console.log(`${t.name}: файл ${before} -> ${after}, HID=${hidVal}  ${ok ? '*** СРАБОТАЛО ***' : 'не сработало'}`);
}

dev.close();
process.exit(0);
