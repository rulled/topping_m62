/**
 * ПОЧЕМУ СЕРВЕР НЕ ВИДИТ 0xa1 И 0x91.
 *
 * ═══ НАБЛЮДЕНИЕ ═══
 *
 * Мой скрипт (закрывает и переоткрывает устройство, пауза 5 с, окно 26 с):
 *     -> 177 адресов, 0x91 и 0xa1 приходят
 *
 * Сервер (одно долгое соединение, открыто один раз):
 *     -> семьи 0x11,0x12,0x21,0x22,0x23,0x25,0x33..0x36,0x62,0x64,0x9b
 *     -> 0x91 и 0xa1 НЕ приходят
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Устройство отдаёт полный дамп (включая EQ и EQ наушников) ТОЛЬКО на
 * свежей сессии, после паузы >= 5 с между подключениями. В одной долгой
 * сессии приходят только «живые» параметры (метры, джойстики, настройки).
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Держим ОДНО соединение 60 секунд и смотрим, появятся ли 0x91/0xa1
 * сами по себе (может, нужен ещё один ANNOUNCE позже).
 *
 * Запуск: node src/tools/test-long-session.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

const state = new Map();
const firstAt = new Map();
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
    const fam = hex2(f.target);
    state.set(`${fam}:${hex2(f.prop)}`, f.value);
    if (!firstAt.has(fam)) firstAt.set(fam, Date.now() - t0);
  }
}

async function main() {
  console.log('=== ОДНА долгая сессия, 60 с ===');
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  let lastKeep = Date.now();
  let lastAnnounce = Date.now();
  while (Date.now() - t0 < 60000) {
    pump();
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    // дополнительный ANNOUNCE каждые 15 с
    if (Date.now() - lastAnnounce >= 15000) {
      send(0x11, PP_ANNOUNCE, 1);
      lastAnnounce = Date.now();
      console.log(`  [${Math.round((Date.now() - t0) / 1000)} с] повторный ANNOUNCE, тегов ${state.size}`);
    }
    await sleep(8);
  }
  pump();
  try { h.close(); } catch { /* ok */ }

  console.log(`\nитого адресов: ${state.size}`);
  console.log('семейства (появление, мс):');
  for (const [fam, at] of [...firstAt.entries()].sort((a, b) => a[1] - b[1])) {
    const n = [...state.keys()].filter((k) => k.startsWith(`${fam}:`)).length;
    console.log(`  0x${fam}: ${String(at).padStart(6)} мс, ${n} тегов`);
  }

  const has91 = [...state.keys()].some((k) => k.startsWith('91:'));
  const hasA1 = [...state.keys()].some((k) => k.startsWith('a1:'));
  console.log(`\n0x91 (EQ входов):    ${has91 ? 'ПРИШЁЛ' : 'НЕТ'}`);
  console.log(`0xa1 (EQ наушников): ${hasA1 ? 'ПРИШЁЛ' : 'НЕТ'}`);

  if (!has91 && !hasA1) {
    console.log('\nВЫВОД: в одной долгой сессии EQ не приходит вообще.');
    console.log('Значит серверу нужно ПЕРИОДИЧЕСКИ переподключаться');
    console.log('(закрыть, пауза >= 5 с, открыть) — иначе EQ и EQ наушников');
    console.log('для него невидимы.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
