/**
 * Проверка: соответствуют ли EQ-блоки 0x91..0x94 полосам из файла?
 *
 * В файле EQ_IN1 = 4 полосы: |тип|частота|Q|gain|
 * В HID блок 0x91 = 10 параметров.
 *
 * Гипотеза: 0x91:01..05 = полосы 1-5 левого, 0x91:06..0a = правого.
 * Проверяем, включив EQ и посмотрев, какие значения придут.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace, parseAll } from '../workspace.js';
import { dumpTree, invoke } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = findActiveWorkspace();
const parsed = parseAll(readWorkspace(ws.path));
console.log(`workspace: ${ws.mode}/${ws.name}`);
for (const e of parsed.eq) {
  console.log(`  ${e.id}: switch=${e.switch} полос=${e.bands.length}`);
  for (const b of e.bands) {
    console.log(`     ${b.band}: тип=${b.type} gain=${b.gain} freq=${b.freq} Q=${b.q}`);
  }
}

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

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

let s = await snap();
console.log('\n=== HID: блоки EQ ===');
for (const tt of [0x91, 0x92, 0x93, 0x94]) {
  const vals = [];
  for (let pp = 1; pp <= 10; pp++) {
    const v = s.get((tt << 8) | pp);
    vals.push(v === undefined ? '—' : v);
  }
  const any = vals.some((v) => v !== '—');
  console.log(`  0x${tt.toString(16)}: ${vals.join(' ')}${any ? '' : '  (нет)'}`);
}
console.log(`\nEQ-переключатели 0x9b:`);
for (const pp of [0x0d, 0x0e, 0x0f, 0x10, 0x12, 0x13]) {
  const v = s.get(0x9b00 | pp);
  if (v !== undefined) console.log(`  0x9b:0x${pp.toString(16)} = ${v}`);
}

dev.close();
process.exit(0);
