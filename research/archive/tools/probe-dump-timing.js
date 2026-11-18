/**
 * ТАЙМИНГ СТАТИЧЕСКОГО ДАМПА.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * probe-all-tags.js видит EQ-теги (0x91..0x94), а короткие снимки по 0.9 с —
 * нет. Значит статические свойства приходят НЕ сразу, а через какое-то время
 * после подписки (возможно, по первому keepalive через 2 с).
 *
 * Этот скрипт замеряет, НА КАКОЙ СЕКУНДЕ приходит каждый блок, чтобы потом
 * делать снимок нужной длины, а не гадать.
 *
 * Ничего не пишем в устройство, кроме служебных кадров.
 *
 * Запуск: node src/tools/probe-dump-timing.js
 */

import HID from 'node-hid';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const WATCH_MS = 12000;
const KEEPALIVE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Первое появление каждого адреса: "tt:pp" -> мс от старта. */
const firstSeen = new Map();
const t0 = Date.now();

function pump() {
  for (let i = 0; i < 256; i++) {
    let buf;
    try {
      buf = h.readTimeout(1);
    } catch {
      return;
    }
    if (!buf || !buf.length) return;
    if (isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    const key = `${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`;
    if (!firstSeen.has(key)) {
      firstSeen.set(key, { at: Date.now() - t0, value: f.value });
    }
  }
}

async function main() {
  const startAt = Date.now();
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  let lastKeep = Date.now();
  while (Date.now() - startAt < WATCH_MS) {
    pump();
    if (Date.now() - lastKeep >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  pump();

  const groups = {
    'EQ 0x91..0x94': (k) => /^9[1-4]:/.test(k),
    'EQ-sw 0x9b': (k) => k.startsWith('9b:'),
    'компрессор 0x46': (k) => k.startsWith('46:'),
    'reverb/FX 0x44': (k) => k.startsWith('44:'),
    'настройки 0x11': (k) => k.startsWith('11:'),
    'инфо 0x12': (k) => k.startsWith('12:'),
    'выходы 0x6x': (k) => /^6[0-9]:/.test(k),
    'входы 0x2x': (k) => /^2[0-9]:/.test(k),
  };

  console.log(`наблюдали ${WATCH_MS} мс, адресов ${firstSeen.size}\n`);
  const buckets = [
    [0, 500], [500, 1000], [1000, 2000], [2000, 3000],
    [3000, 5000], [5000, 8000], [8000, 12000],
  ];
  console.log('когда ПЕРВЫЙ раз появился адрес:');
  for (const [lo, hi] of buckets) {
    const inBucket = [...firstSeen.entries()].filter(([, v]) => v.at >= lo && v.at < hi);
    const tags = [...new Set(inBucket.map(([k]) => k.slice(0, 2)))].sort();
    console.log(`  ${String(lo).padStart(5)}..${String(hi).padStart(5)} мс : ${inBucket.length} адресов` +
      (tags.length ? `  [${tags.join(' ')}]` : ''));
  }

  console.log('\nпо блокам (первое появление):');
  for (const [name, fn] of Object.entries(groups)) {
    const hits = [...firstSeen.entries()].filter(([k]) => fn(k));
    if (!hits.length) {
      console.log(`  ${name}: НЕ ПРИШЛИ`);
      continue;
    }
    const times = hits.map(([, v]) => v.at);
    const n = hits.length;
    console.log(`  ${name}: ${n} адресов, первый в ${Math.min(...times)} мс, последний в ${Math.max(...times)} мс`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
