/**
 * СБОР ВСЕХ АДРЕСОВ, которые устройство присылает само.
 *
 * Ничего не пишем в устройство, кроме handshake/subscribe/announce.
 * Цель — узнать, приходят ли блоки, которых мы раньше не видели:
 * EQ 0xa1..0xaa, loopback 0x51..0x58, ducking 0x43, микшер 0x31..0x36.
 *
 * ВАЖНО: разбор идёт через parseReport, а не вручную. Ручной разбор
 * в первой версии читал TT со смещения 4 вместо 5 и выдавал константу
 * заголовка (0x20 0x01 0x01) вместо адресов.
 *
 * Запуск: node src/tools/probe-all-tags.js [мс]
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
const DURATION_MS = Number(process.argv[2] ?? 20000);
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

const seen = new Map();
let idleReads = 0;
let badFrames = 0;

function drain() {
  for (let i = 0; i < 256; i++) {
    let buf;
    try {
      buf = h.readTimeout(2);
    } catch {
      return;
    }
    if (!buf || !buf.length) return;
    if (isIdle(buf)) {
      idleReads += 1;
      continue;
    }
    const f = parseReport(buf);
    if (!f) {
      badFrames += 1;
      continue;
    }
    const key = `${f.target.toString(16).padStart(2, '0')}:${f.prop
      .toString(16)
      .padStart(2, '0')}`;
    const cur = seen.get(key);
    if (cur) {
      cur.count += 1;
      if (cur.last !== f.value) {
        cur.values.add(f.value);
        cur.last = f.value;
      }
    } else {
      seen.set(key, { count: 1, last: f.value, values: new Set([f.value]) });
    }
  }
}

const main = async () => {
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  drain();

  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(800);

  const t0 = Date.now();
  let lastKeepalive = Date.now();
  while (Date.now() - t0 < DURATION_MS) {
    drain();
    if (Date.now() - lastKeepalive >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeepalive = Date.now();
    }
    await sleep(10);
  }
  drain();

  const groups = {};
  for (const key of seen.keys()) {
    const tt = key.slice(0, 2);
    groups[tt] = (groups[tt] || 0) + 1;
  }

  console.log(`уникальных адресов: ${seen.size}`);
  console.log(`пустых чтений: ${idleReads}, не-кадров: ${badFrames}`);
  console.log('\nпо старшему байту (TT):');
  for (const tt of Object.keys(groups).sort()) {
    console.log(`  0x${tt}: ${groups[tt]} адресов`);
  }

  console.log('\nвсе адреса:');
  const sorted = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, info] of sorted) {
    const vals = [...info.values];
    const vstr =
      vals.length === 1
        ? `=${vals[0]}`
        : `=[${vals.length} знач., последнее ${info.last}]`;
    console.log(`  ${key}  n=${String(info.count).padStart(4)}  ${vstr}`);
  }

  const probes = {
    'EQ 0xa1..0xaa': (k) => /^a[1-9a]:/.test(k),
    'микшер 0x31..0x36': (k) => /^3[1-6]:/.test(k),
    'loopback 0x51..0x58': (k) => /^5[1-8]:/.test(k),
    'ducking 0x43': (k) => k.startsWith('43:'),
    'компрессор 0x46': (k) => k.startsWith('46:'),
    'EQ-полосы 0x91..0x94': (k) => /^9[1-4]:/.test(k),
    'EQ-переключатели 0x9b': (k) => k.startsWith('9b:'),
  };
  console.log('\nцелевые блоки:');
  for (const [name, fn] of Object.entries(probes)) {
    const hits = [...seen.keys()].filter(fn).sort();
    console.log(`  ${name}: ${hits.length ? hits.join(' ') : 'НЕ ПРИШЛИ'}`);
  }

  try {
    h.close();
  } catch {
    /* ok */
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
