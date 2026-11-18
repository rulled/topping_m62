/**
 * Проверка: применились ли значения из файла К УСТРОЙСТВУ.
 *
 * Косвенный признак — счётчик 0x11:0x18 меняется при применении настроек.
 * Прямой — сравнить с состоянием до переключения.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`активный: ${ws.mode}/${ws.name}`);
console.log(`  файл: 48V=${ini.Input_IN1?.['48V']} GAIN=${ini.Input_IN1?.GAIN} MixA=${ini.Mixer_IN12?.MixA_GAIN}`);

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('M62 не найден'); process.exit(1); }

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

const s = new Map(seen);
cap = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3500);
cap = null;
dev.close();

console.log(`\nHID: параметров ${s.size}`);
console.log(`  счётчик 0x11:0x18 = ${s.get(0x1118) ?? '—'}`);
console.log(`  0x21:0x04 = ${s.get(0x2104) ?? '—'}`);

console.log('\nвсе TT=0x11:');
for (const k of [...s.keys()].filter((x) => x >> 8 === 0x11).sort((a, b) => a - b)) {
  console.log(`  0x${k.toString(16)} = ${s.get(k)}`);
}
process.exit(0);
