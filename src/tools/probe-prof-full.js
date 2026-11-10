/**
 * ПРОВЕРКА В PROF: маска ducking, NC3, пресеты — что видно в полном дампе.
 *
 * ═══ ПОЧЕМУ В PROF ═══
 *
 * В Live приходит ~102 тега, в Prof — ~202. Семейства 0x43 (ducking),
 * 0x45 (сцены) в Live могут отсутствовать как раз потому, что
 * блоки не создаются.
 *
 * `prove-ducking-mask.js` в Live показал: 0x43:05/06 не приходят.
 * Проверяем в Prof — возможно, там они есть.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Переключает в Prof (MCC закрыт).
 * 2. Снимает полный дамп.
 * 3. Печатает ВСЕ семейства и теги, которых нет в Live:
 *    ducking, сцены, NC, неизвестные.
 * 4. Возвращает исходный режим.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Проверяет джеки. Смена режима перезагружает устройство.
 * Исходный режим возвращается.
 *
 * Запуск: node src/tools/probe-prof-full.js
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
const MODE = { Mobile: 1, Live: 2, Prof: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function waitDevice(timeoutMs = 35000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (findDev()) return true;
    await sleep(500);
  }
  return false;
}

async function fullSnap(min = 150, attempts = 3) {
  let best = new Map();
  for (let i = 1; i <= attempts; i++) {
    const dev = findDev();
    if (!dev) return best;
    const h = new HID.HID(dev.path);
    const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
    send(0x11, PP_HANDSHAKE, 1);
    await sleep(400);
    send(0x11, PP_SUBSCRIBE, 1);
    await sleep(300);
    send(0x11, PP_ANNOUNCE, 1);

    const out = new Map();
    const t0 = Date.now();
    let lk = Date.now();
    while (Date.now() - t0 < 18000) {
      for (let j = 0; j < 128; j++) {
        let buf;
        try { buf = h.readTimeout(1); } catch { break; }
        if (!buf || !buf.length) break;
        if (isIdle(buf)) continue;
        const f = parseReport(buf);
        if (!f) continue;
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
      if (Date.now() - lk >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lk = Date.now(); }
      await sleep(8);
    }
    try { h.close(); } catch { /* ok */ }
    if (out.size > best.size) best = out;
    if (out.size >= min) return best;
    await sleep(2000);
  }
  return best;
}

async function sendMode(code) {
  const dev = findDev();
  if (!dev) throw new Error('устройство не найдено');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, 0x1d, code);
  await sleep(1000);
  try { h.close(); } catch { /* ok */ }
}

function families(map) {
  const out = new Map();
  for (const k of map.keys()) {
    const f = k.slice(0, 2);
    out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

async function main() {
  console.log('снимок в текущем режиме…');
  const live = await fullSnap(100);
  console.log(`  ${live.size} тегов`);

  if (live.get('64:06') === 1 || live.get('62:06') === 1) {
    console.log('ОСТАНОВ: джек подключён');
    process.exit(2);
  }

  const famLive = families(live);
  const wasProf = live.has('a1:01') || [...live.keys()].some((k) => /^a[1-9a]:/.test(k));

  if (!wasProf) {
    console.log('\nпереключаю в Prof…');
    await sendMode(MODE.Prof);
    if (!await waitDevice()) {
      console.log('устройство не вернулось!');
      process.exit(3);
    }
    await sleep(6000);
  } else {
    console.log('\nуже в Prof');
  }

  console.log('\nснимок в Prof…');
  const prof = await fullSnap(150);
  console.log(`  ${prof.size} тегов`);

  const famProf = families(prof);

  console.log('\n' + '='.repeat(66));
  console.log('СЕМЕЙСТВА: ТЕКУЩИЙ РЕЖИМ vs PROF');
  console.log('='.repeat(66));
  const allFam = new Set([...famLive.keys(), ...famProf.keys()]);
  const onlyProf = [];
  for (const f of [...allFam].sort()) {
    const a = famLive.get(f) ?? 0;
    const b = famProf.get(f) ?? 0;
    const mark = a === 0 ? '+' : (b === 0 ? '-' : ' ');
    console.log(`${mark} 0x${f}  ${String(a).padStart(3)} -> ${String(b).padStart(3)}`);
    if (a === 0 && b > 0) onlyProf.push({ fam: f, keys: [...prof.keys()].filter((k) => k.startsWith(f + ':')) });
  }

  if (onlyProf.length) {
    console.log('\n' + '='.repeat(66));
    console.log('ПОЯВИЛОСЬ ТОЛЬКО В PROF');
    console.log('='.repeat(66));
    for (const o of onlyProf) {
      console.log(`\n  0x${o.fam} (${o.keys.length}):`);
      for (const k of o.keys.sort()) console.log(`    0x${k} = ${prof.get(k)}`);
    }
  }

  // --- конкретно интересующие блоки ---
  console.log('\n' + '='.repeat(66));
  console.log('ИНТЕРЕСУЮЩИЕ БЛОКИ В PROF');
  console.log('='.repeat(66));

  const check = (label, re) => {
    const keys = [...prof.keys()].filter((k) => re.test(k)).sort();
    if (!keys.length) {
      console.log(`  ${label}: НЕТ`);
    } else {
      console.log(`  ${label} (${keys.length}):`);
      for (const k of keys) console.log(`    0x${k} = ${prof.get(k)}`);
    }
  };

  check('ducking 0x43', /^43:/);
  check('сцены 0x45', /^45:/);
  check('NC/эффекты 0x44', /^44:/);
  check('пресеты 0x11:08/0e', /^11:(08|0e)$/);
  check('0x11:1x', /^11:1[0-9a-f]$/);
  check('0x9b', /^9b:/);

  // --- вернуть режим ---
  if (!wasProf) {
    console.log('\nвозвращаю исходный режим…');
    await sendMode(MODE.Live);
    await waitDevice();
    await sleep(5000);
    const back = await fullSnap(100);
    console.log(`  вернулось: ${back.size} тегов`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
