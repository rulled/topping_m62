/**
 * СОСТОЯНИЕ БЕЗОПАСНОСТИ: наушники и OTG.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Перед любым тестом со звуком надо убедиться, что наушники отключены
 * и выходы заглушены. Скрипт читает живые теги прямо из HID и печатает
 * вердикт. Ничего не пишет.
 *
 * ═══ ЧТО ЧИТАЕТ ═══
 *
 *   0x64:0x06  наушники подключены физически
 *   0x62:0x06  OTG подключён
 *   0x64:0x04  MUTE наушников
 *   0x62:0x04  MUTE OTG
 *   0x64:0x03  громкость наушников
 *   0x62:0x03  громкость OTG
 *
 * Запуск: node src/tools/safety-check.js
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
const LISTEN_MS = 12000;

const WATCH = {
  '64:06': 'наушники подключены',
  '62:06': 'OTG подключён',
  '64:04': 'MUTE наушников',
  '62:04': 'MUTE OTG',
  '64:03': 'громкость наушников',
  '62:03': 'громкость OTG',
  '64:02': 'источник наушников',
  '62:02': 'источник OTG',
};

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
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    if (Date.now() - lastAnnounce >= 5000) {
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

  console.log('=== СОСТОЯНИЕ ВЫХОДОВ ===');
  for (const [key, label] of Object.entries(WATCH)) {
    const v = state.get(key);
    console.log(`  0x${key}  ${label.padEnd(22)} ${v === undefined ? 'НЕТ ТЕГА' : v}`);
  }

  const hpJack = state.get('64:06');
  const otgJack = state.get('62:06');
  const hpMute = state.get('64:04');
  const otgMute = state.get('62:04');

  console.log('\n=== ВЕРДИКТ ===');
  const hpSafe = hpJack === 0 || hpMute === 1;
  const otgSafe = otgJack === 0 || otgMute === 1;

  console.log(`  наушники: ${hpJack === 1 ? 'ПОДКЛЮЧЕНЫ' : hpJack === 0 ? 'отключены' : '?'}`
    + `, MUTE=${hpMute ?? '?'} -> ${hpSafe ? 'БЕЗОПАСНО' : 'ОПАСНО (звук возможен)'}`);
  console.log(`  OTG:      ${otgJack === 1 ? 'подключён' : otgJack === 0 ? 'отключён' : '?'}`
    + `, MUTE=${otgMute ?? '?'} -> ${otgSafe ? 'БЕЗОПАСНО' : 'ОПАСНО (звук возможен)'}`);

  if (!hpSafe || !otgSafe) {
    console.log('\n  ВНИМАНИЕ: перед тестом со звуком заглушите выходы.');
    process.exitCode = 2;
  } else {
    console.log('\n  Звук физически невозможен — можно тестировать.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
