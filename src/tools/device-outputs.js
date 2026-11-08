/**
 * ЧТО У УСТРОЙСТВА СЕЙЧАС — по всем тегам выходов.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * После тестового захвата в INI были расставлены другие источники
 * и все слоты заглушены. INI восстановили, но устройство получило
 * тестовые значения и живёт с ними, пока MCC не перезапустится
 * и не отправит восстановленный файл заново.
 *
 * Скрипт показывает, что реально в устройстве прямо сейчас.
 * Ничего не пишет.
 *
 * Запуск: node src/tools/device-outputs.js
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

const Q25_UNITY = 33554432;
const Q25_HALF = 16777216;

const SOURCE_NAMES = {
  0: 'Unknown', 1: 'Mix A', 2: 'Mix B', 3: 'Mix C',
  6: 'IN 1', 7: 'IN 2', 8: 'IN 1+2', 9: 'AUX', 10: 'BT',
  11: 'OTG IN', 12: 'Playback 1/2', 13: 'Playback 3/4',
  14: 'Playback 5/6', 15: 'Playback 7/8', 16: 'Playback 9/10', 17: 'FX',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Q25 -> дБ. 0 = минус бесконечность. */
function q25ToDb(v) {
  if (v === 0) return '-inf';
  const db = 20 * Math.log10(v / Q25_UNITY);
  return `${db.toFixed(2)} dB`;
}

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

  const box = (title, groups) => {
    console.log(`\n${title}`);
    for (const tt of groups) {
      const props = [...state.keys()]
        .filter((k) => k.startsWith(`${hex2(tt)}:`))
        .sort();
      if (!props.length) {
        console.log(`  0x${hex2(tt)}: тегов нет`);
        continue;
      }
      const parts = props.map((k) => {
        const pp = k.slice(3);
        const v = state.get(k);
        let note = '';
        if (pp === '02') note = ` = ${SOURCE_NAMES[v] ?? `?${v}`}`;
        else if (pp === '03') note = ` (${q25ToDb(v)})`;
        return `0x${pp}=${v}${note}`;
      });
      console.log(`  0x${hex2(tt)}: ${parts.join('  ')}`);
    }
  };

  console.log('=== ВЫХОДЫ ===');
  box('OTG OUT (0x61/0x62):', [0x61, 0x62]);
  box('Наушники (0x63/0x64):', [0x63, 0x64]);

  console.log('\n=== ЧТО ЭТО ЗНАЧИТ ===');
  const hpSrc = state.get('64:02');
  const otgSrc = state.get('62:02');
  const hpMute = state.get('64:04');
  const otgMute = state.get('62:04');

  if (hpSrc === undefined && otgSrc === undefined) {
    console.log('  Селекторы (PP=0x02) не читаются — устройство их не сообщает.');
    console.log('  Это норма: они write-only во всех захватах.');
    console.log('  Значит узнать, куда сейчас указывает выход, по HID НЕЛЬЗЯ.');
    console.log('  Источник истины — INI-файл и то, что MCC в него запишет.');
  } else {
    if (hpSrc !== undefined) console.log(`  HP источник: ${SOURCE_NAMES[hpSrc] ?? hpSrc}`);
    if (otgSrc !== undefined) console.log(`  OTG источник: ${SOURCE_NAMES[otgSrc] ?? otgSrc}`);
  }
  console.log(`  HP MUTE  0x64:0x04 = ${hpMute ?? 'нет тега'}`);
  console.log(`  OTG MUTE 0x62:0x04 = ${otgMute ?? 'нет тега'}`);

  const hpGain = state.get('63:03') ?? state.get('64:03');
  if (hpGain !== undefined) console.log(`  HP громкость = ${hpGain} (${q25ToDb(hpGain)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
