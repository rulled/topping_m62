/**
 * ТЕКУЩЕЕ СОСТОЯНИЕ: режим, безопасность, какие блоки приходят.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Режим устройства меняет состав блоков:
 *
 *   Live    микшер A-E, loopback, ducking, эффекты. EQ наушников НЕТ.
 *   Mobile  эффекты есть, микшера и loopback нет.
 *   Prof    EQ наушников (0xa1..0xaa) есть, эффектов НЕТ.
 *
 * Перед любым тестом надо знать, в каком режиме находишься, иначе
 * «тег не пришёл» можно принять за отказ устройства.
 *
 * Запуск: node src/tools/state-check.js
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
const SLEEP_MS = 22000;

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

  const st = new Map();
  const t0 = Date.now();
  let lk = 0;
  let la = 0;

  while (Date.now() - t0 < SLEEP_MS) {
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
      st.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    if (Date.now() - la >= 6000) {
      send(0x11, PP_ANNOUNCE, 1);
      la = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }

  const keys = [...st.keys()];
  const has = (re) => keys.some((k) => re.test(k));

  const families = {};
  for (const k of keys) families[k.slice(0, 2)] = (families[k.slice(0, 2)] || 0) + 1;

  console.log('='.repeat(58));
  console.log(`ТЕГОВ: ${st.size}   СЕМЕЙСТВ: ${Object.keys(families).length}`);
  console.log('='.repeat(58));

  const eqHp = keys.filter((k) => /^a[1-9a]:/.test(k)).length;
  const eqIn = keys.filter((k) => /^9[1-4]:/.test(k)).length;
  const loop = keys.filter((k) => /^5[1-8]:/.test(k)).length;
  const duck = keys.filter((k) => k.startsWith('43:')).length;
  const fx = keys.filter((k) => k.startsWith('44:')).length;
  const mix = keys.filter((k) => /^3[1-8b-c]:/.test(k) && !k.endsWith(':15')).length;

  console.log('\nПРИЗНАКИ РЕЖИМА:');
  console.log(`  EQ наушников 0xa1..0xaa : ${eqHp ? `ЕСТЬ (${eqHp})` : 'нет'}`);
  console.log(`  EQ входов    0x91..0x94 : ${eqIn ? `ЕСТЬ (${eqIn})` : 'нет'}`);
  console.log(`  loopback     0x51..0x58 : ${loop ? `ЕСТЬ (${loop})` : 'нет'}`);
  console.log(`  ducking      0x43       : ${duck ? `ЕСТЬ (${duck})` : 'нет'}`);
  console.log(`  эффекты      0x44       : ${fx ? `ЕСТЬ (${fx})` : 'нет'}`);
  console.log(`  микшер       0x31..0x3c : ${mix ? `ЕСТЬ (${mix})` : 'нет'}`);

  // определение режима — ЧЕРЕЗ ОБЩИЙ МОДУЛЬ, а не своей копией логики.
  // Раньше здесь была вторая, независимая реализация, и она разошлась
  // с src/modes.js: на устройстве в Live показывала Mobile, потому что
  // тоже искала loopback 0x51..0x58, которого в потоке не бывает.
  const { detectModeFromHid } = await import('../modes.js');
  const snap = Object.fromEntries(st);
  const det = detectModeFromHid(snap);
  console.log(`\n  => РЕЖИМ: ${det.mode} (уверенность: ${det.confidence})`);
  for (const r of det.reasons ?? []) console.log(`     · ${r}`);

  // безопасность
  const hp = st.get('64:06');
  const otg = st.get('62:06');
  const hpMute = st.get('64:04');
  const otgMute = st.get('62:04');
  console.log('\nБЕЗОПАСНОСТЬ:');
  console.log(`  наушники 0x64:06=${hp ?? '?'}  MUTE 0x64:04=${hpMute ?? '?'}`);
  console.log(`  OTG      0x62:06=${otg ?? '?'}  MUTE 0x62:04=${otgMute ?? '?'}`);
  const safe = (hp === 0 || hpMute === 1) && (otg === 0 || otgMute === 1);
  console.log(`  => ${safe ? 'звук невозможен — можно тестировать' : 'ОПАСНО: звук возможен'}`);

  // ключевые значения EQ входов
  console.log('\nEQ ВХОДОВ, полоса 1 (канал IN1):');
  for (const pp of ['01', '02', '03', '04', '05']) {
    const v = st.get(`91:${pp}`);
    const name = { '01': 'вкл', '02': 'тип', '03': 'gain', '04': 'частота', '05': 'Q' }[pp];
    console.log(`  0x91:${pp} ${name.padEnd(8)} = ${v ?? '—'}`);
  }

  console.log('\nСЕМЕЙСТВА:');
  for (const f of Object.keys(families).sort()) {
    console.log(`  0x${f}: ${families[f]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
