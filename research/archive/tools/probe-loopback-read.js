/**
 * ПРОБА: ЧИТАЕТСЯ ЛИ LOOPBACK (0x51..0x58) ИЗ HID?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Коды источников (name -> code) сейчас известны только через USBPcap:
 * MCC при старте шлёт bulk push, и в нём видно, какой код он подставил
 * для имени из INI. Захват требует админа.
 *
 * Если loopback приходит в IN — можно обойтись без захвата:
 *   1. поставить имя в INI
 *   2. запустить MCC (он запушит)
 *   3. закрыть MCC
 *   4. прочитать 0x51:0x02 из HID
 *
 * Этот скрипт отвечает на вопрос «п.4 вообще возможен».
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Открывает сессию, шлёт handshake + subscribe, затем несколько ANNOUNCE
 * (одного мало — EQ-блоки приходят только после повторного запроса),
 * слушает 20 с и печатает:
 *   - режим по семействам
 *   - есть ли 0x51..0x58 и что в них
 *   - есть ли 0x62:0x02 / 0x64:0x02 (селекторы выходов)
 *
 * Запуск: node src/tools/probe-loopback-read.js
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
const LISTEN_MS = 20000;
const ANNOUNCE_EVERY_MS = 5000;
const KEEPALIVE_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 iface 4 не найден');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  const state = new Map();
  const t0 = Date.now();
  let lastKeep = 0;
  let lastAnnounce = 0;

  while (Date.now() - t0 < LISTEN_MS) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      state.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }

    if (Date.now() - lastKeep >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    if (Date.now() - lastAnnounce >= ANNOUNCE_EVERY_MS) {
      send(0x11, PP_ANNOUNCE, 1);
      lastAnnounce = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }

  const keys = [...state.keys()].sort();
  const families = {};
  for (const k of keys) {
    const tt = k.slice(0, 2);
    families[tt] = (families[tt] || 0) + 1;
  }

  console.log(`адресов всего: ${state.size}`);
  console.log(`семейств: ${Object.keys(families).length}`);

  console.log('\n--- LOOPBACK 0x51..0x58 ---');
  const lb = keys.filter((k) => /^5[1-8]:/.test(k));
  if (!lb.length) {
    console.log('  НЕТ НИ ОДНОГО ТЕГА — loopback обратно не читается');
  } else {
    for (const k of lb) console.log(`  0x${k} = ${state.get(k)}`);
  }

  console.log('\n--- СЕЛЕКТОРЫ ВЫХОДОВ 0x62/0x64 : 0x02 ---');
  for (const k of ['62:02', '64:02']) {
    console.log(`  0x${k} = ${state.has(k) ? state.get(k) : 'НЕТ ТЕГА'}`);
  }

  console.log('\n--- ПРИЗНАКИ РЕЖИМА ---');
  const has = (re) => keys.some((k) => re.test(k));
  console.log(`  0xa1..0xaa (EQ наушников, только Prof): ${has(/^a[1-9a]:/) ? 'ЕСТЬ' : 'нет'}`);
  console.log(`  0x44 (эффекты): ${has(/^44:/) ? 'ЕСТЬ' : 'нет'}`);
  console.log(`  0x51..0x58 (loopback, только Live): ${lb.length ? 'ЕСТЬ' : 'нет'}`);
  console.log(`  0x91..0x94 (EQ входов): ${has(/^9[1-4]:/) ? 'ЕСТЬ' : 'нет'}`);
  console.log(`  0x43 (ducking): ${has(/^43:/) ? 'ЕСТЬ' : 'нет'}`);

  console.log('\n--- ПО СЕМЕЙСТВАМ ---');
  for (const tt of Object.keys(families).sort()) {
    console.log(`  0x${tt}: ${families[tt]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
