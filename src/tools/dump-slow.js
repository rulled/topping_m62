/**
 * Полный дамп с увеличенным окном — для Prof-режима.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * dump-mode.js слушает 7.5 с. В Prof-режиме этого хватает (168 адресов),
 * но иногда приходит только 12 — значит часть блоков приходит ПОЗЖЕ.
 *
 * В Live EQ приходил на ~4.5 с. В Prof блоков больше (174 против 100),
 * поэтому волн может быть больше, и последние приходят позже.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Слушает 20 секунд и записывает ВРЕМЯ первого появления каждого
 * семейства. Так видно, что и когда приходит.
 *
 * Запуск: node src/tools/dump-slow.js <имя> [мс]
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

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
const name = process.argv[2] ?? 'slow';
const SNAPSHOT_MS = Number(process.argv[3] ?? 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hex2 = (n) => n.toString(16).padStart(2, '0');

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

async function main() {
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  const state = new Map();
  const firstAt = new Map();
  const t0 = Date.now();

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  let lastKeep = Date.now();
  let idle = 0;
  while (Date.now() - t0 < SNAPSHOT_MS) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) {
        idle += 1;
        continue;
      }
      const f = parseReport(buf);
      if (!f) continue;
      const key = `${hex2(f.target)}:${hex2(f.prop)}`;
      state.set(key, f.value);
      const fam = hex2(f.target);
      if (!firstAt.has(fam)) firstAt.set(fam, Date.now() - t0);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  const families = {};
  for (const k of state.keys()) {
    const tt = k.slice(0, 2);
    families[tt] = (families[tt] || 0) + 1;
  }

  const dump = {
    mode: name,
    capturedAt: new Date().toISOString(),
    listenedMs: SNAPSHOT_MS,
    total: state.size,
    families,
    firstAtMs: Object.fromEntries([...firstAt.entries()].sort()),
    tags: Object.fromEntries([...state.entries()].sort()),
  };
  const outFile = path.join('research', `mode-${name}.json`);
  writeFileSync(outFile, JSON.stringify(dump, null, 2), 'utf8');

  console.log(`режим: ${name}`);
  console.log(`слушали: ${SNAPSHOT_MS} мс, пустых: ${idle}`);
  console.log(`адресов: ${state.size}`);
  console.log(`файл: ${outFile}`);

  console.log('\nкогда пришло каждое семейство (мс от старта):');
  const sorted = [...firstAt.entries()].sort((a, b) => a[1] - b[1]);
  for (const [fam, at] of sorted) {
    console.log(`  0x${fam}: ${String(at).padStart(6)} мс, ${families[fam]} тегов`);
  }

  const ab = [...state.keys()].filter((k) => /^a[1-9ab]:/.test(k)).length;
  console.log(`\nблоки 0xa1..0xab: ${ab} тегов`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
