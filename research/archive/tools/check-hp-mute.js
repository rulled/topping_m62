/**
 * ПРОВЕРКА: применился ли mute наушников.
 *
 * Предохранитель в probe-9b-focused.js остановил тест, потому что
 * 0x64:04 не появился в снимке после записи. Два варианта:
 *   A. mute НЕ применился (реально опасно);
 *   B. mute применился, но тег 0x64:04 не приходит в поток
 *      (это известная проблема: часть адресов приходит нестабильно).
 *
 * Проверяем БЕЗ записи в звук: читаем больший снимок и смотрим,
 * приходит ли 0x64:04 вообще, и пробуем 0x64:03 (громкость).
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

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snapshot(ms) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const counts = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let j = 0; j < 128; j++) {
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
      const k = `${hex2(f.target)}:${hex2(f.prop)}`;
      out.set(k, f.value);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }
  return { out, counts };
}

async function main() {
  console.log('=== ПРИХОДИТ ЛИ 0x64:0x04 ВООБЩЕ? ===');
  for (let i = 1; i <= 2; i += 1) {
    const { out, counts } = await snapshot(12000);
    console.log(`\nпрогон ${i}: тегов ${out.size}`);
    console.log('  семейство 0x64 (наушники):');
    for (const [k, v] of [...out.entries()].filter(([k]) => k.startsWith('64:'))) {
      console.log(`    ${k} = ${v}   (пришёл ${counts.get(k)}x)`);
    }
    console.log('  семейство 0x62 (OTG):');
    for (const [k, v] of [...out.entries()].filter(([k]) => k.startsWith('62:'))) {
      console.log(`    ${k} = ${v}   (пришёл ${counts.get(k)}x)`);
    }
    await sleep(1500);
  }

  console.log('\n' + '='.repeat(58));
  console.log('ВЫВОД');
  console.log('='.repeat(58));
  console.log('  Если 0x64:04 приходит = 1 — mute применился, тест безопасен.');
  console.log('  Если 0x64:04 не приходит в поток вообще — тег не читается');
  console.log('  назад, и судить о mute по нему нельзя (нужен другой метод).');
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
