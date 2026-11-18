/**
 * Проверка: сообщает ли устройство о микшере, если запросить состояние (ANNOUNCE)?
 *
 * Гипотеза: микшер/селекторы не имеют физической ручки, поэтому устройство
 * не присылает о них события само. Но на запрос полного состояния
 * (TT=0x11, PP=0x26) оно может отдать всё, что знает.
 *
 * Мы шлём ТОЛЬКО ANNOUNCE — это запрос состояния, тот же кадр, что шлёт
 * M Control Center при запуске. Ни один параметр не меняется.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Map();
let collecting = false;
const collected = [];

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const msg = parseReport(b);
  if (!msg) return;
  const key = `${msg.target.toString(16).padStart(2, '0')}:${msg.prop.toString(16).padStart(2, '0')}`;
  const prev = seen.get(key);
  seen.set(key, msg.value);
  if (collecting) {
    collected.push({ key, value: msg.value, prev: prev ?? null });
  }
});

const run = async () => {
  console.log('1) слушаю 2 с (фон)');
  await sleep(2000);
  seen.clear();

  console.log('2) шлю ANNOUNCE (TT=0x11 PP=0x26) — только запрос состояния');
  collecting = true;
  const frame = withReportId(buildFrame(0x11, 0x26, 1, true));
  dev.write([...frame]);
  await sleep(6000);
  collecting = false;

  console.log(`\n3) получено записей: ${collected.length}`);
  const byKey = new Map();
  for (const c of collected) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c.value);
  }
  console.log('\nTT:PP     значений   примеры');
  for (const [k, v] of [...byKey.entries()].sort()) {
    const u = [...new Set(v)];
    const meter = u.length > 5 && u.every((x) => x < -100) ? '  (метр)' : '';
    console.log(`  ${k.padEnd(8)} x${String(v.length).padStart(3)}  ${u.slice(0, 10).join(', ')}${u.length > 10 ? '…' : ''}${meter}`);
  }

  const mixer = [...byKey.keys()].filter((k) => {
    const tt = parseInt(k.split(':')[0], 16);
    return tt >= 0x41 && tt <= 0x48;
  });
  console.log(`\nтеги семейства 0x41..0x48 (микшер по моей формуле): ${mixer.length ? mixer.join(', ') : 'НЕТ'}`);

  try { dev.close(); } catch { /* уже */ }
  process.exit(0);
};

run();
