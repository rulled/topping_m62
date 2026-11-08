/**
 * Пакетная проверка настроек: переключаем каждую и смотрим тег.
 *
 * Только через UIA (MCC пишет). Мы читаем HID.
 *
 * Запуск: node src/tools/probe-settings.js
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = found.find((d) => d.interface === IFACE);
  if (!vp) return null;
  try { return new HID.HID(vp.path); } catch { return null; }
}

let dev = connect();
if (!dev) { console.error('M62 не найден'); process.exit(1); }

const seen = new Map();
let cap = null;
function hook(d) {
  d.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    const k = (m.target << 8) | m.prop;
    seen.set(k, m.value);
    if (cap) cap.set(k, m.value);
  });
  d.on('error', () => { /* переподключимся */ });
}
hook(dev);

async function snap(ms = 2200) {
  const s = new Map(seen);
  cap = s;
  try { dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]); } catch { /* ок */ }
  await sleep(ms);
  cap = null;
  return s;
}

const hex = (k) => '0x' + k.toString(16).padStart(4, '0');

async function testToggle(name, label) {
  const { items } = dumpTree();
  const lbl = items.find((x) => (x.name || '').trim() === label);
  if (!lbl) { console.log(`\n${name}: подпись "${label}" не найдена`); return; }
  const t = items.find(
    (x) => x.cls === 'QPushButton' && Math.abs(x.ly - lbl.ly) < 28 && x.i !== lbl.i,
  );
  if (!t) { console.log(`\n${name}: переключатель не найден`); return; }

  const before = await snap();
  console.log(`\n=== ${name} ===`);
  console.log(`  элемент [${t.i}]`);
  const r = await invoke(t.i);
  console.log(`  ${r}`);
  await sleep(1500);
  const after = await snap();

  let n = 0;
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k), b = after.get(k);
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100) continue;
    console.log(`  ${hex(k)}  ${a} -> ${b}   <<<`);
    n++;
  }
  if (!n) console.log('  (нет изменений)');
}

await testToggle('Bluetooth', 'Bluetooth');
await testToggle('Auto Power On/Off', 'Auto Power On/Off');

dev.close();
process.exit(0);
