/**
 * EQ В PROF-РЕЖИМЕ: МОЖЕТ, ОН ПИШЕТСЯ ТОЛЬКО ТАМ?
 *
 * ═══ ПОЧЕМУ ЭТА ГИПОТЕЗА ═══
 *
 * 1. Известно: EQ наушников 0xa1..0xaa есть ТОЛЬКО в Prof-режиме.
 * 2. Сейчас устройство в Live. Блоки 0x91..0x94 приходят, но запись
 *    в них НЕ принимается ни одним из 9 проверенных способов
 *    (одиночный кадр, брекет, save, гейт через 0x9b, все поля,
 *    долгий простой 35 с и 65 с, дамп через 11/26).
 * 3. Внешняя документация (NTMan/topping-m62) числит EQ в разделе
 *    «Still unknown» — его не расшифровал даже автор протокола.
 *
 * Значит остаётся проверить режим: в Live EQ может быть только
 * для чтения, а в Prof — записываемым.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Переключает устройство в Prof (0x11:0x1d = 3).
 * 2. Ждёт перезагрузку и переподключение HID.
 * 3. Пробует записать EQ-полосу: одиночным кадром и брекетом.
 * 4. Возвращает Live.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Смена режима перезагружает карту; звук в этот момент невозможен.
 * Наушники проверяются до начала. Всё возвращается в Live.
 *
 * Запуск: node src/tools/prove-eq-prof-mode.js
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
  PP_BULK_BEGIN,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

const MODE_PROF = 3;
const MODE_LIVE = 2;

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

async function waitForDevice(timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = findDev();
    if (d) {
      // пробуем открыть — если получится, устройство готово
      try {
        const h = new HID.HID(d.path);
        h.close();
        return true;
      } catch {
        /* ещё грузится */
      }
    }
    await sleep(1000);
  }
  return false;
}

function open() {
  const dev = findDev();
  if (!dev) throw new Error('устройство не найдено');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  return { h, send };
}

async function prepare(send) {
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
}

async function readFresh(ms = 12000) {
  const { h, send } = open();
  await prepare(send);
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

async function writeSingle(frames) {
  const { h, send } = open();
  await prepare(send);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(200);
  }
  await sleep(900);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function writeBulk(frames) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(130);
  }
  await sleep(250);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(800);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function setMode(mode) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, 0x1d, mode);
  await sleep(1500);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

/** Определить режим по семействам в снимке. */
function detectMode(snap) {
  const has = (t) => [...snap.keys()].some((k) => k.startsWith(`${t}:`));
  if (has('a1') || has('a2')) return 'Prof';
  if (has('44')) return 'Live';
  if (has('43')) return 'Mobile';
  return '?';
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ В PROF-РЕЖИМЕ');
  console.log('='.repeat(70));

  const s0 = await readFresh(8000);
  const jack = s0.get('64:06');
  const mute0 = s0.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  if (jack === 1 && mute0 !== 1) {
    await writeSingle([[0x64, 0x04, 1]]);
    if ((await readFresh(7000)).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  } else {
    console.log('  безопасно');
  }

  console.log(`\nтекущий режим: ${detectMode(s0)}`);

  // ─── переключаем в Prof ───
  console.log('\n' + '-'.repeat(70));
  console.log('переключаю в Prof (0x11:0x1d = 3)…');
  console.log('-'.repeat(70));
  try {
    await setMode(MODE_PROF);
  } catch (e) {
    console.log(`  отправка не удалась (ожидаемо при перезагрузке): ${e.message}`);
  }
  await sleep(8000);
  const up = await waitForDevice(45000);
  console.log(`  устройство поднялось: ${up}`);
  await sleep(3000);

  if (!up) {
    console.log('  ОСТАНОВ: устройство не вернулось');
    process.exit(1);
  }

  const sp = await readFresh(14000);
  const mode = detectMode(sp);
  console.log(`  режим после переключения: ${mode}`);
  console.log(`  адресов в снимке: ${sp.size}`);

  const eqArrived = [...sp.keys()].filter((k) => /^9[1-4]:/.test(k)).sort();
  console.log(`  блоки EQ 0x91..0x94: ${eqArrived.length} адресов`);
  const eqhp = [...sp.keys()].filter((k) => /^a[1-9a]:/.test(k)).sort();
  console.log(`  блоки EQ наушников 0xa1..0xaa: ${eqhp.length} адресов`);

  const st = {
    en1: sp.get('91:01'),
    g1: sp.get('91:03'),
    f1: sp.get('91:04'),
  };
  console.log('\nисходное в Prof:');
  console.log(`  0x91:01=${st.en1}  0x91:03=${st.g1}  0x91:04=${st.f1}`);

  const results = [];

  // ─── попытка 1: одиночный кадр ───
  console.log('\n' + '-'.repeat(70));
  console.log('A: одиночный кадр 0x91:03 = 6');
  console.log('-'.repeat(70));
  await writeSingle([[0x91, 0x03, 6]]);
  let r = await readFresh();
  let got = r.get('91:03');
  let ok = got === 6;
  console.log(`  читается: ${got}   ${ok ? 'ПРИНЯТО' : 'не принято'}`);
  results.push({ label: 'A одиночный кадр', ok });

  // ─── попытка 2: брекет ───
  console.log('\n' + '-'.repeat(70));
  console.log('B: брекет [0x91:01=1, 0x91:03=6, 0x91:04=1000]');
  console.log('-'.repeat(70));
  await writeBulk([
    [0x91, 0x01, 1],
    [0x91, 0x03, 6],
    [0x91, 0x04, 1000],
  ]);
  r = await readFresh();
  got = r.get('91:03');
  const gotF = r.get('91:04');
  ok = got === 6 || gotF === 1000;
  console.log(`  0x91:03=${got}  0x91:04=${gotF}   ${ok ? 'ПРИНЯТО' : 'не принято'}`);
  results.push({ label: 'B брекет', ok });

  // ─── попытка 3: EQ наушников 0xa1 ───
  if (eqhp.length) {
    console.log('\n' + '-'.repeat(70));
    console.log('C: EQ наушников 0xa1:03 = 6 (только в Prof)');
    console.log('-'.repeat(70));
    const bh = sp.get('a1:03');
    await writeSingle([[0xa1, 0x03, 6]]);
    r = await readFresh();
    got = r.get('a1:03');
    ok = got === 6;
    console.log(`  было ${bh}, читается ${got}   ${ok ? 'ПРИНЯТО' : 'не принято'}`);
    results.push({ label: 'C EQ наушников', ok });
  }

  // ─── возврат в Live ───
  console.log('\n' + '-'.repeat(70));
  console.log('возвращаю Live (0x11:0x1d = 2)…');
  console.log('-'.repeat(70));
  try {
    await setMode(MODE_LIVE);
  } catch {
    /* ожидаемо */
  }
  await sleep(8000);
  const backUp = await waitForDevice(45000);
  console.log(`  устройство поднялось: ${backUp}`);
  if (backUp) {
    await sleep(3000);
    const fin = await readFresh(10000);
    console.log(`  режим: ${detectMode(fin)}`);
    console.log(`  наушники: jack=${fin.get('64:06')} mute=${fin.get('64:04')}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(24)} ${r.ok ? 'РАБОТАЕТ' : 'не работает'}`);
  }
  const anyOk = results.some((r) => r.ok);
  console.log('');
  if (anyOk) {
    console.log('  В Prof-режиме EQ ПИШЕТСЯ. Значит дело было в режиме:');
    console.log('  в Live блоки EQ только для чтения.');
  } else {
    // ═══ ВАЖНО: ЭТОТ ВЫВОД УСТАРЕЛ ═══
    //
    // Тест писался, когда считалось, что EQ не пишется вовсе.
    // Потом выяснилось: причина была не в тегах и не в режиме,
    // а в ТАЙМИНГЕ — после удержания сессии нужна ещё пауза
    // ~4 с до закрытия, а подтверждать надо НОВОЙ сессией
    // (см. `prove-eq-in2-live.js`, 5/5, и `prove-eq-hp-live.js`).
    //
    // Этот скрипт закрывает сессию сразу после записи и читает
    // в той же сессии, поэтому он ОБЯЗАН показывать «не работает»
    // даже когда запись на самом деле проходит. Он оставлен как
    // история замеров, но его вердикт больше не является истиной.
    console.log('  ⚠ ЭТОТ ВЕРДИКТ УСТАРЕЛ И НЕ ЯВЛЯЕТСЯ ИСТИНОЙ.');
    console.log('');
    console.log('  Скрипт закрывает сессию сразу после записи и читает');
    console.log('  в той же сессии. По нынешним данным это ГАРАНТИРУЕТ');
    console.log('  «не работает» независимо от того, применилась ли');
    console.log('  запись: прошивке нужно ~4 с после удержания, а EQ');
    console.log('  повторно приходит только в НОВОЙ сессии.');
    console.log('');
    console.log('  Актуальная проверка:');
    console.log('    node src/tools/prove-eq-in2-live.js   EQ входов, 5/5');
    console.log('    node src/tools/prove-eq-hp-live.js    EQ наушников');
    console.log('');
    console.log('  Этот скрипт оставлен как история замеров режимов.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
