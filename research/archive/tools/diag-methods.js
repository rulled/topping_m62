/**
 * Отладка: сравнить два способа получить настройки.
 *
 * A) как в read-settings.js: открыть HID напрямую, БЕЗ subscribe, шлём ANNOUNCE
 * B) как в транспорте: subscribe + announce сразу
 *
 * Смотрим, какой даёт полный набор тегов настроек.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = {
  0x1104: 'Brightness', 0x111a: 'Bluetooth', 0x111b: 'OtgPower',
  0x111c: 'UsbCPower', 0x111e: 'AutoPower', 0x1122: 'BtnSingle',
  0x1123: 'BtnDouble', 0x1118: 'counter',
};

function openDev() {
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = found.find((d) => d.interface === IFACE);
  if (!vp) return null;
  try { return new HID.HID(vp.path); } catch { return null; }
}

async function trial(name, { subscribe, announceCount, gapMs, preWaitMs }) {
  const dev = openDev();
  if (!dev) { console.log(`${name}: устройство не открылось`); return; }

  const seen = new Map();
  const counts = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    const k = (m.target << 8) | m.prop;
    seen.set(k, m.value);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });

  await sleep(preWaitMs);

  if (subscribe) dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
  await sleep(500);
  for (let i = 0; i < announceCount; i++) {
    dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
    await sleep(gapMs);
  }

  const keys = Object.keys(TARGETS).map(Number);
  const got = keys.filter((k) => seen.has(k));
  console.log(`\n${name}`);
  console.log(`  subscribe=${subscribe} announces=${announceCount} gap=${gapMs} preWait=${preWaitMs}`);
  console.log(`  тегов настроек: ${got.length}/${keys.length}, всего в потоке: ${seen.size}`);
  for (const k of keys) {
    const v = seen.get(k);
    if (v !== undefined) {
      console.log(`     0x${k.toString(16).padStart(4, '0')} ${TARGETS[k].padEnd(12)} = ${v}`);
    }
  }

  try { dev.close(); } catch { /* ok */ }
  await sleep(800);
}

// A: без подписки, как read-settings
await trial('A: без subscribe, 1 announce, ждём 3 с', {
  subscribe: false, announceCount: 1, gapMs: 3000, preWaitMs: 1200,
});

// B: с подпиской
await trial('B: с subscribe, 1 announce, ждём 3 с', {
  subscribe: true, announceCount: 1, gapMs: 3000, preWaitMs: 1200,
});

// C: без подписки, 3 announce
await trial('C: без subscribe, 3 announce по 1 с', {
  subscribe: false, announceCount: 3, gapMs: 1000, preWaitMs: 1200,
});

// D: с подпиской и долгим ожиданием
await trial('D: с subscribe, 1 announce, ждём 6 с', {
  subscribe: true, announceCount: 1, gapMs: 6000, preWaitMs: 1500,
});

process.exit(0);
