/**
 * ПРОВЕРКА НАСТРОЕК: нажимаем элемент в MCC и смотрим, какие теги изменились.
 *
 * Пишет MCC (через UIA Invoke). Мы только читаем HID.
 *
 * Запуск:
 *   node src/tools/probe-ui.js --list
 *   node src/tools/probe-ui.js --idx 116 --label "scene Chat"
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

if (args.includes('--list')) {
  const { scale, items } = dumpTree();
  console.log(`DPI scale: ${scale}`);
  console.log('интерактивные элементы с именем:');
  for (const x of items) {
    if (!x.name || !x.name.trim()) continue;
    if (!/[ITRSE]/.test(x.pats)) continue;
    console.log(`  [${String(x.i).padStart(3)}] (${x.lx},${x.ly}) ${x.cls.padEnd(18)} [${x.pats}] ${x.name.replace(/\n/g, '/')}`);
  }
  process.exit(0);
}

const idx = Number(arg('idx', '-1'));
const label = arg('label', 'без метки');
if (idx < 0) { console.error('укажи --idx'); process.exit(1); }

// --- HID ---
const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const latest = new Map();
let capture = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});

async function snap(ms = 2500) {
  const s = new Map(latest);
  capture = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  capture = null;
  return s;
}

const hexTag = (k) => '0x' + k.toString(16).padStart(4, '0');

console.log(`ПРОВЕРКА: ${label} (idx=${idx})\n`);

const before = await snap();
console.log(`снимок ДО: ${before.size} параметров`);

console.log(`нажимаю [${idx}]...`);
console.log('  ' + invoke(idx));

await sleep(1500);
const after = await snap();
console.log(`снимок ПОСЛЕ: ${after.size} параметров\n`);

console.log('=== ИЗМЕНЕНИЯ ===');
let n = 0;
for (const k of new Set([...before.keys(), ...after.keys()])) {
  const a = before.get(k), b = after.get(k);
  if (a === b) continue;
  const isMeter = typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100;
  const mark = isMeter ? '  (метр)' : '   <<<';
  console.log(`  ${hexTag(k)}  ${String(a).padStart(7)} -> ${String(b).padStart(7)}${mark}`);
  if (!isMeter) n++;
}
if (!n) console.log('  (нет изменений кроме метров)');

dev.close();
process.exit(0);
