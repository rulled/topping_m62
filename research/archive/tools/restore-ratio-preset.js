/**
 * Может ли Load preset восстановить Ratio?
 *
 * Ratio сейчас 0.8 (сбит тестами), исходное было 4.
 * Load preset1/2 должен вернуть сохранённое в устройстве значение.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

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

const fileComp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return { thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack), rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix) };
};

const hidComp = () => ({
  thr: seen.get(0x4602), ratio: seen.get(0x4603), att: seen.get(0x4604),
  rel: seen.get(0x4605), gain: seen.get(0x4606), mix: seen.get(0x4608),
});

console.log('=== ДО ===');
console.log('  файл:', JSON.stringify(fileComp()));

for (const [name, prop] of [['preset1', 0x0e], ['preset2', 0x12]]) {
  console.log(`\n=== LOAD ${name} (0x11:0x${prop.toString(16)}) ===`);
  dev.write([...withReportId(buildFrame(0x11, prop, 1, true))]);
  await sleep(6000);

  // читаем HID (пресет отдаёт компрессор)
  cap = seen;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(2500);
  cap = null;

  console.log('  HID:', JSON.stringify(hidComp()));
  console.log('  файл:', JSON.stringify(fileComp()));
}

console.log('\n=== ИТОГ ===');
const h = hidComp();
const f = fileComp();
console.log(`  Ratio: HID=${h.ratio}, файл=${f.ratio}`);
if (h.ratio === 40) {
  console.log('  HID говорит Ratio = 40 (=4.0) — пресет хранит ИСХОДНОЕ значение!');
  console.log('  Но в файл оно НЕ попало — MCC перезаписывает своим.');
} else if (h.ratio === 8) {
  console.log('  HID говорит Ratio = 8 (=0.8) — пресет хранит текущее, не исходное');
} else {
  console.log(`  HID говорит Ratio = ${h.ratio}`);
}

dev.close();
process.exit(0);
