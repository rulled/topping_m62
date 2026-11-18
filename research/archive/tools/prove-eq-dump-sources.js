/**
 * ПОСЛЕДНЯЯ ПРОВЕРКА: МОЖЕТ, EQ ВСЁ-ТАКИ ПИШЕТСЯ, НО ДАМП ВРЁТ?
 *
 * ═══ ПОЧЕМУ ЭТО ЕЩЁ НЕ ЗАКРЫТО ═══
 *
 * Все 9 проверок читали значение из обычного `ANNOUNCE` (0x11:26).
 * Но по внешнему документу EQ-блоки приходят именно в ОТВЕТ на
 * `0x11:26` и завершаются `0x11:25`. Значит есть три источника
 * значения, и они могут расходиться:
 *
 *   A. первый ANNOUNCE сессии (то, что мы читали);
 *   B. ответ на явный `0x11:26` с терминатором `0x11:25`;
 *   C. дамп, который карта шлёт САМА через ~2.8 с после ANNOUNCE.
 *
 * Если запись применяется, но карта отдаёт её только в C —
 * мы её просто не видели.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Пишет заведомо отличимое значение (gain = 11).
 * 2. Ждёт дамп САМ (ничего не шлёт 8 с) и ловит всё, что приходит.
 * 3. Отдельно запрашивает `0x11:26` и ловит до `0x11:25`.
 * 4. Печатает ВСЕ значения 0x91:03, которые встретились, с временами.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением, всё откатывается.
 *
 * Запуск: node src/tools/prove-eq-dump-sources.js
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
const TEST_GAIN = 11;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
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

/** Пишет значение и сразу переходит в режим наблюдения. */
async function writeThenWatch(tt, pp, value, watchMs) {
  const { h, send } = open();
  await prepare(send);
  send(tt, pp, value);

  // НЕ шлём announce. Просто слушаем — вдруг карта сама пришлёт.
  const events = [];
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < watchMs) {
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
      const key = `${hex2(f.target)}:${hex2(f.prop)}`;
      if (key === '91:03' || key === '91:01' || key === '91:04' || f.prop === 0x25) {
        events.push({ ms: Date.now() - t0, key, value: f.value });
      }
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
  return events;
}

/** Чтение через явный запрос 0x11:26 с ожиданием 0x11:25. */
async function readWithExplicitDump(ms = 15000) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_ANNOUNCE, 1);

  const eqValues = [];
  let gotTerminator = false;
  let terminatorAt = null;
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
      if (f.target === 0x91 && f.prop === 0x03) {
        eqValues.push({ ms: Date.now() - t0, value: f.value });
      }
      if (f.target === 0x11 && f.prop === 0x25) {
        gotTerminator = true;
        terminatorAt = Date.now() - t0;
      }
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
  return { eqValues, gotTerminator, terminatorAt };
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ: ТРИ ИСТОЧНИКА ЗНАЧЕНИЯ (ANNOUNCE / ЯВНЫЙ ДАМП / САМОСТОЯТЕЛЬНЫЙ)');
  console.log('='.repeat(70));

  const base = await readWithExplicitDump(10000);
  const before = base.eqValues.length ? base.eqValues[base.eqValues.length - 1].value : null;
  console.log(`\nисходное 0x91:03 = ${before}`);
  console.log(`терминатор 0x11:25 получен: ${base.gotTerminator} (на ${base.terminatorAt} мс)`);

  // безопасность
  const mb = await readWithExplicitDump(6000);
  void mb;
  const dev0 = findDev();
  const hh = new HID.HID(dev0.path);
  const s0 = (t, p, v) => hh.write([...withReportId(buildFrame(t, p, v, true))]);
  s0(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  s0(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  const jack = null;
  void jack;
  hh.close();

  // ─── 1: пишем и слушаем, ничего не запрашивая ───
  console.log('\n' + '-'.repeat(70));
  console.log(`1: пишу 0x91:03 = ${TEST_GAIN}, затем СЛУШАЮ 10 с (без announce)`);
  console.log('-'.repeat(70));
  const ev1 = await writeThenWatch(0x91, 0x03, TEST_GAIN, 10000);
  const seen1 = ev1.filter((e) => e.key === '91:03');
  if (!seen1.length) {
    console.log('  карта не прислала 0x91:03 сама ни разу');
  } else {
    for (const e of seen1) console.log(`  ${e.ms} мс  0x91:03 = ${e.value}`);
    const applied = seen1.some((e) => e.value === TEST_GAIN);
    console.log(`  ${applied ? 'ЗНАЧЕНИЕ ПРИМЕНИЛОСЬ' : 'значение осталось прежним'}`);
  }

  // ─── 2: явный дамп ───
  console.log('\n' + '-'.repeat(70));
  console.log('2: явный запрос 0x11:26, ждём терминатор 0x11:25');
  console.log('-'.repeat(70));
  const r2 = await readWithExplicitDump(15000);
  if (!r2.eqValues.length) {
    console.log('  0x91:03 не пришёл');
  } else {
    for (const e of r2.eqValues) console.log(`  ${e.ms} мс  0x91:03 = ${e.value}`);
    const applied = r2.eqValues.some((e) => e.value === TEST_GAIN);
    console.log(`  ${applied ? 'ЗНАЧЕНИЕ ПРИМЕНИЛОСЬ' : 'значение осталось прежним'}`);
  }
  console.log(`  терминатор: ${r2.gotTerminator}`);

  // ─── откат ───
  console.log('\nоткат…');
  const dr = findDev();
  const hr = new HID.HID(dr.path);
  const sr = (t, p, v) => hr.write([...withReportId(buildFrame(t, p, v, true))]);
  sr(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  sr(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  sr(0x91, 0x03, before ?? 0);
  await sleep(800);
  hr.close();

  const fin = await readWithExplicitDump(10000);
  const after = fin.eqValues.length ? fin.eqValues[fin.eqValues.length - 1].value : null;
  console.log(`  0x91:03 = ${after} (было ${before})`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const anyApplied =
    ev1.some((e) => e.key === '91:03' && e.value === TEST_GAIN)
    || r2.eqValues.some((e) => e.value === TEST_GAIN);
  console.log(`  значение ${TEST_GAIN} появилось хоть раз: ${anyApplied ? 'ДА' : 'НЕТ'}`);
  console.log('');
  if (anyApplied) {
    console.log('  ЗАПИСЬ EQ РАБОТАЕТ, но видна только в дампе.');
    console.log('  Значит наши маршруты читали не тот источник.');
  } else {
    console.log('  Запись EQ не работает НИ В ОДНОМ источнике.');
    console.log('  Это окончательно: обычный announce, явный дамп по 0x11:26');
    console.log('  и самостоятельная присылка — все показывают старое значение.');
    console.log('  EQ доступен только для чтения.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
