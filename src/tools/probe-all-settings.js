/**
 * Полный цикл: открыть настройки -> вкладка Device -> проверить все тумблеры.
 *
 * Только через UIA (пишет MCC). Читаем HID.
 *
 * Запуск: node src/tools/probe-all-settings.js
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, invoke } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HID ----------
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
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

async function snap(ms = 2000) {
  const s = new Map(seen);
  cap = s;
  try { dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]); } catch { /* ok */ }
  await sleep(ms);
  cap = null;
  return s;
}

const hex = (k) => '0x' + k.toString(16).padStart(4, '0');

// ---------- UI ----------
async function openDeviceTab() {
  let { items } = dumpTree();
  // уже открыто?
  if (items.some((x) => (x.name || '').trim() === 'Mode select')) return true;

  // шестерёнка
  const gear = items.find(
    (x) => x.cls === 'QPushButton' && !x.name && x.w >= 28 && x.w <= 52 && x.h >= 28 && x.h <= 52,
  );
  if (!gear) return false;
  await invoke(gear.i);
  await sleep(1600);

  ({ items } = dumpTree());
  const tab = items.find((x) => (x.name || '').trim() === 'Device');
  if (tab) {
    await invoke(tab.i);
    await sleep(1200);
  }
  ({ items } = dumpTree());
  return items.some((x) => (x.name || '').trim() === 'Mode select');
}

const ok = await openDeviceTab();
console.log(`вкладка Device открыта: ${ok}\n`);
if (!ok) { console.error('не удалось открыть настройки'); process.exit(1); }

// ---------- тесты ----------
async function testControl(label, kind) {
  const { items } = dumpTree();
  const lbl = items.find((x) => (x.name || '').trim() === label);
  if (!lbl) { console.log(`\n### ${label}: подпись не найдена`); return; }

  let ctl;
  if (kind === 'toggle') {
    ctl = items.find((x) => x.cls === 'QPushButton' && x.i !== lbl.i && Math.abs(x.ly - lbl.ly) < 30 && /T/.test(x.pats));
  } else {
    ctl = items.find((x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - lbl.ly) < 30);
  }
  if (!ctl) { console.log(`\n### ${label}: контрол не найден`); return; }

  const before = await snap();
  console.log(`\n### ${label}  [${ctl.i}] ${ctl.cls}`);

  if (kind === 'toggle') {
    console.log('  ' + (await invoke(ctl.i)));
  } else {
    const r = await invoke(ctl.i);
    console.log(`  (combo: ${r} — переключаем клавиатурой)`);
  }
  await sleep(1400);
  const after = await snap();

  let n = 0;
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k), b = after.get(k);
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100) continue;
    console.log(`     ${hex(k)}  ${a} -> ${b}   <<<`);
    n++;
  }
  if (!n) console.log('     (нет изменений)');
}

await testControl('Bluetooth', 'toggle');
await testControl('Auto Power On/Off', 'toggle');

dev.close();
process.exit(0);
