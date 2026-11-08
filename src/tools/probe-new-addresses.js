/**
 * Поиск НОВЫХ адресов, которых не было в наших дампах.
 *
 * Из отчёта субагента (по PROTOCOL.md):
 *   0x51..0x58  loopback: /02 source, /03 gain Q25
 *   0xa1..0xaa  EQ-блоки (второй набор)
 *   0x43/01..07 ducking
 *   0x44/01..0f reverb + NR
 *
 * Мы видели только 0x43 (частично), 0x44, 0x91..0x94.
 * Проверяем, приходят ли 0x51..0x58 и 0xa1..0xaa.
 *
 * БЕЗОПАСНОСТЬ: только ЧТЕНИЕ (handshake + subscribe + announce).
 * Ничего не пишем в устройство.
 *
 * Запуск: node src/tools/probe-new-addresses.js
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) { console.error('M62 не найден'); process.exit(1); }

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function collect(ms) {
  const tags = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let buf;
    try { buf = h.readTimeout(30); } catch { break; }
    if (!buf || !buf.length) continue;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = b;
    if (!(b[0] === 0x22 && b[1] === 0x33) && b[1] === 0x22) f = b.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    tags.set(`0x${f[5].toString(16)}:0x${f[6].toString(16).padStart(2, '0')}`, f.readInt32BE(7));
  }
  return tags;
}

const GROUPS = {
  'loopback 0x51..0x58': /^0x5[1-8]:/,
  'EQ-блоки 0xa1..0xaa': /^0xa[1-9a]:/,
  'ducking 0x43': /^0x43:/,
  'reverb/NR 0x44': /^0x44:/,
  'EQ 0x91..0x94': /^0x9[1-4]:/,
  'компрессор 0x46': /^0x46:/,
};

const main = async () => {
  const ka = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 1900);

  console.log('=== handshake ===');
  send(0x11, 0x01, 1);
  const ans = await collect(1200);
  console.log(`  11/01 = ${ans.get('0x11:0x01')}`);

  console.log('\n=== subscribe + announce ===');
  send(0x11, 0x24, 1);
  await sleep(300);
  send(0x11, 0x26, 1);
  const t1 = await collect(8000);
  console.log(`  тегов: ${t1.size}`);

  // Bulk push bracket: 11/20 = 1 ... 11/20 = 0
  console.log('\n=== bulk bracket 11/20 (может вызвать dump EQ) ===');
  send(0x11, 0x20, 1);
  await sleep(400);
  send(0x11, 0x20, 0);
  await sleep(400);

  console.log('\n=== ещё announce (через 3 с) ===');
  await sleep(3000);
  send(0x11, 0x26, 1);
  const t2 = await collect(8000);
  console.log(`  тегов: ${t2.size}`);

  const all_tags = new Map([...t1, ...t2]);

  console.log('\n=== ГРУППЫ ===');
  for (const [name, re] of Object.entries(GROUPS)) {
    const found = [...all_tags.keys()].filter((k) => re.test(k)).sort();
    console.log(`\n  ${name}: ${found.length}`);
    for (const k of found) console.log(`    ${k} = ${all_tags.get(k)}`);
  }

  console.log('\n=== ВСЕ теги (для сверки) ===');
  const ttGroups = new Map();
  for (const k of all_tags.keys()) {
    const tt = k.split(':')[0];
    if (!ttGroups.has(tt)) ttGroups.set(tt, 0);
    ttGroups.set(tt, ttGroups.get(tt) + 1);
  }
  for (const [tt, n] of [...ttGroups.entries()].sort()) {
    console.log(`  ${tt}: ${n} свойств`);
  }

  console.log(`\nВСЕГО уникальных тегов: ${all_tags.size}`);

  clearInterval(ka);
  h.close();
};

main().catch((e) => { console.error('ошибка:', e.message); process.exit(1); });
