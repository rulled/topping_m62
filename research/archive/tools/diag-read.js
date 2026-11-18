/**
 * ГИПОТЕЗА: транспорт теряет пакеты, потому что читает через readTimeout(200)
 * в цикле с setTimeout(0), а прямой HID слушает событие 'data'.
 *
 * Проверяем: один и тот же ANNOUNCE, два способа чтения.
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

// --- способ 1: событие data ---
async function byEvent() {
  const dev = openDev();
  if (!dev) return null;
  const seen = new Map();
  let raw = 0;
  dev.on('data', (buf) => {
    raw++;
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });
  await sleep(800);
  dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
  await sleep(500);
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(3500);
  try { dev.close(); } catch { /* ok */ }
  return { seen, raw };
}

// --- способ 2: опрос readTimeout ---
async function byPoll() {
  const dev = openDev();
  if (!dev) return null;
  const seen = new Map();
  let raw = 0, idle = 0, empty = 0;
  let stop = false;

  const pump = () => {
    while (!stop) {
      let d;
      try { d = dev.readTimeout(100); } catch { break; }
      if (!d || !d.length) { empty++; continue; }
      raw++;
      const b = d instanceof Uint8Array ? d : Uint8Array.from(d);
      if (isIdle(b)) { idle++; continue; }
      const m = parseReport(b);
      if (!m) continue;
      seen.set((m.target << 8) | m.prop, m.value);
    }
  };

  await sleep(800);
  dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
  await sleep(500);
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);

  // качаем в отдельном потоке через setTimeout-цикл, как в транспорте
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    let d;
    try { d = dev.readTimeout(100); } catch { break; }
    if (!d || !d.length) { empty++; continue; }
    raw++;
    const b = d instanceof Uint8Array ? d : Uint8Array.from(d);
    if (isIdle(b)) { idle++; continue; }
    const m = parseReport(b);
    if (!m) continue;
    seen.set((m.target << 8) | m.prop, m.value);
  }

  stop = true;
  try { dev.close(); } catch { /* ok */ }
  return { seen, raw, idle, empty };
}

const a = await byEvent();
console.log('=== событие data ===');
if (a) {
  const got = TARGETS.filter((k) => a.seen.has(k)).length;
  console.log(`  сырых отчётов: ${a.raw}, параметров: ${a.seen.size}, настроек ${got}/${TARGETS.length}`);
  for (const k of TARGETS) {
    const v = a.seen.get(k);
    if (v !== undefined) console.log(`    0x${k.toString(16)} = ${v}`);
  }
}

await sleep(1500);

const b = await byPoll();
console.log('\n=== опрос readTimeout(100) ===');
if (b) {
  const got = TARGETS.filter((k) => b.seen.has(k)).length;
  console.log(`  сырых: ${b.raw}, idle: ${b.idle}, пустых: ${b.empty}, параметров: ${b.seen.size}, настроек ${got}/${TARGETS.length}`);
  for (const k of TARGETS) {
    const v = b.seen.get(k);
    if (v !== undefined) console.log(`    0x${k.toString(16)} = ${v}`);
  }
}

process.exit(0);
