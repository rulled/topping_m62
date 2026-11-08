/**
 * Проверка гипотезы: KEEPALIVE (0x11:0x24 каждые 2 с) сбивает ответ ANNOUNCE.
 *
 * Метод A (без subscribe) дал 8/8. Транспорт с keepalive — 2/8.
 * Значит именно периодическая подписка мешает.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [0x1104, 0x1118, 0x111a, 0x111b, 0x111c, 0x111e, 0x1122, 0x1123];

function openDev() {
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = found.find((d) => d.interface === IFACE);
  if (!vp) return null;
  try { return new HID.HID(vp.path); } catch { return null; }
}

async function trial(name, { keepalive, waitMs }) {
  const dev = openDev();
  if (!dev) { console.log(`${name}: не открылось`); return; }

  const seen = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });

  await sleep(1000);

  // подписка (нужна потоку)
  dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
  await sleep(600);

  // keepalive параллельно?
  let ka = null;
  if (keepalive) {
    ka = setInterval(() => {
      try { dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]); } catch { /* ok */ }
    }, 2000);
  }

  // ОДИН announce
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(waitMs);

  if (ka) clearInterval(ka);

  const got = TARGETS.filter((k) => seen.has(k)).length;
  console.log(`${name.padEnd(38)} настроек ${got}/${TARGETS.length}, всего ${seen.size}`);
  if (got) {
    const s = TARGETS.filter((k) => seen.has(k))
      .map((k) => `0x${k.toString(16)} = ${seen.get(k)}`)
      .join(', ');
    console.log(`   ${s}`);
  }

  try { dev.close(); } catch { /* ok */ }
  await sleep(1000);
}

await trial('БЕЗ keepalive, ждём 3.5 с', { keepalive: false, waitMs: 3500 });
await trial('С keepalive (2 с), ждём 3.5 с', { keepalive: true, waitMs: 3500 });
await trial('С keepalive (2 с), ждём 6 с', { keepalive: true, waitMs: 6000 });
await trial('БЕЗ keepalive, ждём 6 с', { keepalive: false, waitMs: 6000 });

process.exit(0);
