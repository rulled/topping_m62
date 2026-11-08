/**
 * Определение РЕЖИМА устройства по набору тегов, которые оно присылает.
 *
 * `0x11:0x1d` (FirmwareSelected) устройство не возвращает никогда —
 * проверено после смены режима. Но режим виден косвенно:
 *   - в Live streaming есть эффекты (0x44) и Loopback
 *   - в Pro audio есть EQ наушников (0xab)
 *   - в Mobile нет микшера
 *
 * Запуск: node src/tools/detect-mode.js
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
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

const s = new Map(seen);
cap = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3000);
cap = null;
dev.close();

// --- косвенные признаки ---
const hasFx = [...s.keys()].some((k) => (k >> 8) === 0x44);
const hasEqHeadphone = [...s.keys()].some((k) => (k >> 8) === 0xab);
const hasEqBanks = [0x91, 0x92, 0x93, 0x94].filter((t) => [...s.keys()].some((k) => (k >> 8) === t));
const hasDucking = s.has(0x4307);

// из UI: сколько шин микшера
let busCount = null;
try {
  const { items } = dumpTree();
  const mixes = items.filter((x) => /^Mix [A-H]$/.test(x.name || '') && x.cls === 'QLabel');
  busCount = new Set(mixes.map((m) => m.name)).size;
} catch { /* окно закрыто */ }

console.log(`параметров с устройства: ${s.size}\n`);
console.log('=== КОСВЕННЫЕ ПРИЗНАКИ РЕЖИМА ===');
console.log(`  эффекты 0x44 (FX/NC/Reverb):   ${hasFx ? 'ЕСТЬ' : 'нет'}`);
console.log(`  EQ наушников 0xab:             ${hasEqHeadphone ? 'ЕСТЬ' : 'нет'}`);
console.log(`  блоки EQ 0x91..0x94:           ${hasEqBanks.length ? hasEqBanks.map((b) => '0x' + b.toString(16)).join(',') : 'нет'}`);
console.log(`  ducking 0x43:0x07:             ${hasDucking ? 'ЕСТЬ' : 'нет'}`);
console.log(`  шин микшера в UI:              ${busCount === null ? '?' : busCount}`);

console.log('\n=== ВЕРДИКТ ===');
let mode = 'неизвестно';
if (busCount === 5 || (hasFx && !hasEqHeadphone)) mode = 'Live streaming (5 шин, эффекты)';
else if (busCount === 3 || hasEqHeadphone) mode = 'Pro audio (3 шины, EQ наушников)';
else if (busCount === 0) mode = 'Mobile (нет микшера)';
console.log(`  ${mode}`);
console.log(`\n  0x11:0x1d (FirmwareSelected) = ${s.has(0x111d) ? s.get(0x111d) : 'НЕ ПРИХОДИТ (устройство не возвращает)'}`);
