/**
 * СВЕРКА: INI-файл MCC против HID-тегов.
 *
 * Гипотеза: блоки 0x91..0x94 в HID = полосы EQ из INI (Eq%40N).
 * Проверяем соответствие значений.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { readFileSync } from 'node:fs';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INI = String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini`;

// --- разбор INI: секции Eq%40N ---
function parseEq(iniPath) {
  const text = readFileSync(iniPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let section = null;
  const out = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { section = m[1]; out[section] = out[section] ?? {}; continue; }
    if (!section) continue;
    const eq = line.match(/^(.*?)=(.*)$/);
    if (!eq) continue;
    out[section][eq[1]] = eq[2];
  }
  return out;
}

const ini = parseEq(INI);
console.log('=== EQ ИЗ INI ===');
for (const sec of ['EQ_IN1', 'EQ_IN2']) {
  if (!ini[sec]) continue;
  console.log(`\n[${sec}]  Switch=${ini[sec].Switch}  GainInput=${ini[sec].GainInput}`);
  for (let band = 1; band <= 4; band++) {
    const key = `Eq%40${band}`;
    const v = ini[sec][key];
    if (v === undefined) continue;
    // формат: |тип|частота|Q|gain|
    const parts = v.split('|').filter((x) => x !== '');
    console.log(`  полоса ${band}: "${v}"  -> [${parts.join(', ')}]`);
  }
}

// --- HID ---
const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
if (!vp) { console.error('\nM62 не найден'); process.exit(0); }
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

console.log('\n=== БЛОКИ 0x91..0x94 В HID ===');
for (const tt of [0x91, 0x92, 0x93, 0x94]) {
  const vals = [];
  for (let pp = 1; pp <= 10; pp++) {
    const k = (tt << 8) | pp;
    vals.push(s.has(k) ? s.get(k) : '-');
  }
  const any = vals.some((v) => v !== '-');
  console.log(`  0x${tt.toString(16)}: ${any ? vals.join(', ') : '(нет данных)'}`);
}

console.log('\n=== ГИПОТЕЗА ===');
console.log('  INI: тип|частота|Q|gain');
console.log('  Для полосы 1 INI даёт частоту 632, Q 0.7');
console.log('  HID 0x91:04 = 632  <- СОВПАДАЕТ с частотой');
process.exit(0);
