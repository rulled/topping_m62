/**
 * Найти неклассифицированные теги: собираем всё, что приходит,
 * и показываем те, для которых classifyTag даёт null.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { classifyTag } from '../tags.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const unknown = new Map();
const known = new Set();
let total = 0;

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  total++;
  const tag = (m.target << 8) | m.prop;
  const c = classifyTag({ target: m.target, prop: m.prop, value: m.value });
  if (c) { known.add(tag); return; }
  // настройки (0x11, 0x45) обрабатываются отдельно — не считаем их unknown
  if (m.target === 0x11 || m.target === 0x45) { known.add(tag); return; }
  if (!unknown.has(tag)) unknown.set(tag, { count: 0, values: new Set() });
  const u = unknown.get(tag);
  u.count++;
  if (u.values.size < 10) u.values.add(m.value);
});

await sleep(800);
dev.write([...withReportId(buildFrame(0x11, 0x24, 1, true))]);
await sleep(400);
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(5000);

console.log(`всего отчётов: ${total}, известных тегов: ${known.size}, НЕИЗВЕСТНЫХ: ${unknown.size}\n`);
if (unknown.size) {
  console.log('тег      получен  примеры значений');
  for (const [tag, u] of [...unknown.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const vals = [...u.values].slice(0, 8).join(', ');
    console.log(`0x${tag.toString(16).padStart(4, '0')}   ${String(u.count).padStart(4)}×   ${vals}`);
  }
} else {
  console.log('все теги классифицированы');
}

dev.close();
process.exit(0);
