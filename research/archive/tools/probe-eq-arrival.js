/**
 * ПРИХОДЯТ ЛИ БЛОКИ EQ (0x91..0x94) ОТ УСТРОЙСТВА?
 *
 * ═══ ПОЧЕМУ ЭТО РЕШАЮЩИЙ ВОПРОС ═══
 *
 * Сегодня (2026-11-13) запись в 0x91:03 не принимается ни одним из
 * 4 способов, хотя NOTES §135.2 (2026-11-10) фиксировал 7/7 принятых.
 *
 * `detect-mode.js` уже намекнул:
 *     блоки EQ 0x91..0x94:  НЕТ
 *
 * Если устройство НЕ ПРИСЫЛАЕТ эти блоки, значит оно их не отдаёт
 * в текущем состоянии — и запись игнорирует. Причина может быть:
 *   - EQ выключен глобально, и устройство не публикует блоки;
 *   - в текущем режиме (Live) EQ-полосы не активны;
 *   - блоки приходят только на ПЕРВЫЙ ANNOUNCE (известное правило),
 *     и мы их просто не поймали из-за короткого окна.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Открывает НЕСКОЛЬКО сессий подряд с разной длительностью и
 * печатает ВСЕ адреса, которые пришли. Особое внимание — 0x91..0x94,
 * 0x9b, 0xa1..0xaa.
 *
 * Запуск: node src/tools/probe-eq-arrival.js
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
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

async function session(ms) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
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
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
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
  return out;
}

async function main() {
  console.log('='.repeat(72));
  console.log('ПРИХОДЯТ ЛИ БЛОКИ EQ (0x91..0x94) ОТ УСТРОЙСТВА?');
  console.log('='.repeat(72));

  for (const ms of [8000, 16000]) {
    const snap = await session(ms);
    console.log(`\n${'-'.repeat(72)}`);
    console.log(`СЕССИЯ ${ms} мс — адресов: ${snap.size}`);
    console.log('-'.repeat(72));

    const fam = {};
    for (const k of snap.keys()) {
      const tt = k.slice(0, 2);
      fam[tt] = (fam[tt] || 0) + 1;
    }
    console.log('семейства:');
    for (const tt of Object.keys(fam).sort()) {
      console.log(`  0x${tt}: ${fam[tt]} адресов`);
    }

    const eq = [...snap.entries()].filter(([k]) => /^9[1-4]:/.test(k)).sort();
    console.log(`\nEQ-полосы 0x91..0x94: ${eq.length ? `${eq.length} адресов` : 'НЕ ПРИШЛИ'}`);
    for (const [k, v] of eq) console.log(`  ${k} = ${v}`);

    const nineB = [...snap.entries()].filter(([k]) => k.startsWith('9b:')).sort();
    console.log(`\n0x9b: ${nineB.length ? `${nineB.length} адресов` : 'НЕ ПРИШЛИ'}`);
    for (const [k, v] of nineB) console.log(`  ${k} = ${v}`);

    const eqhp = [...snap.entries()].filter(([k]) => /^a[1-9a]:/.test(k)).sort();
    console.log(`\nEQ наушников 0xa1..0xaa: ${eqhp.length ? `${eqhp.length} адресов` : 'НЕ ПРИШЛИ'}`);
    for (const [k, v] of eqhp.slice(0, 8)) console.log(`  ${k} = ${v}`);

    await sleep(2500);
  }

  console.log('\n' + '='.repeat(72));
  console.log('ЧТО ЭТО ЗНАЧИТ');
  console.log('='.repeat(72));
  console.log('  0x91..0x94 приходят  -> устройство публикует EQ, но не принимает');
  console.log('                          запись => проблема в методе записи');
  console.log('  0x91..0x94 НЕ приходят -> устройство не отдаёт EQ в текущем');
  console.log('                          состоянии => сначала надо включить EQ');
  console.log('                          или переключить режим');
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
