/** Полный дамп HID-состояния по семействам. */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

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

// несколько запросов с паузами — устройство отдаёт по частям
for (let i = 0; i < 3; i++) {
  cap = seen;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(1800);
}
cap = null;
dev.close();

const byFamily = new Map();
for (const k of seen.keys()) {
  const tt = k >> 8;
  if (!byFamily.has(tt)) byFamily.set(tt, []);
  byFamily.get(tt).push(k & 0xff);
}

console.log(`всего параметров: ${seen.size}\n`);
console.log('семейство  кол-во  значения (pp=hex)');
for (const tt of [...byFamily.keys()].sort((a, b) => a - b)) {
  const pps = byFamily.get(tt).sort((a, b) => a - b);
  const vals = pps.map((pp) => `${pp.toString(16)}=${seen.get((tt << 8) | pp)}`);
  console.log(`  0x${tt.toString(16).padStart(2, '0')}      ${String(pps.length).padStart(2)}    ${vals.join(' ')}`);
}

console.log('\n=== ЧЕГО НЕТ (по карте) ===');
const EXPECT = {
  0x43: 'ducking', 0x44: 'эффекты', 0x46: 'компрессор',
  0x91: 'EQ банк 1', 0x92: 'EQ банк 2', 0x9b: 'EQ переключатели', 0xab: 'EQ HP',
};
for (const [tt, name] of Object.entries(EXPECT)) {
  const n = byFamily.get(Number(tt))?.length ?? 0;
  console.log(`  0x${Number(tt).toString(16)} ${name.padEnd(16)} ${n ? n + ' шт' : 'НЕТ'}`);
}
process.exit(0);
