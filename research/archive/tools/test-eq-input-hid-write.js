/**
 * МОЖНО ЛИ ПИСАТЬ EQ ВХОДОВ ПРЯМО ЧЕРЕЗ HID — перепроверка на чистом пути.
 *
 * ═══ ПОЧЕМУ ПЕРЕПРОВЕРКА ═══
 *
 * В research/NOTES.md §123 записано «EQ пишется через HID, 8/8».
 * Но сервер (`/api/eq/band`, `/api/eq/band/enable`) пишет через
 * UI MCC — двигает дилы клавишами, и требует открытого окна EQ.
 *
 * Значит одно из двух:
 *   а) запись через HID действительно работает, и сервер просто
 *      использует устаревший путь (это можно исправить и убрать
 *      зависимость от MCC);
 *   б) запись через HID не работает, а §123 был ошибочным замером.
 *
 * Этот скрипт ставит точку. Пишет ОДИН параметр напрямую
 * `send(0x91, 0x03, gain)` и смотрит, пришло ли новое значение
 * в свежем ANNOUNCE.
 *
 * ═══ ЧТО ВАЖНО ДЛЯ ЧИСТОТЫ ОПЫТА ═══
 *
 * - MCC должен быть ЗАКРЫТ (иначе откатит запись).
 * - Снимок должен быть ДЛИННЫМ: в Prof блоки 0x91 приходят
 *   только после повторного ANNOUNCE, на 18-19 секунде.
 * - «undefined» после записи = не увидели, а не «отказано».
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется только gain полосы 1 EQ входа IN1, в пределах -3..+3 дБ
 * и возвращается назад. Наушники и OTG проверяются и должны быть
 * отключены.
 *
 * Запуск: node src/tools/test-eq-input-hid-write.js
 *
 * ⚠️ ПЕРЕД ЗАПУСКОМ: MCC должен быть ЗАКРЫТ ПОЛНОСТЬЮ (не в трее).
 * Если он висит в трее, он держит HID-поток: приходит ~30 тегов
 * вместо 177 и блоков 0x91 нет вообще. Тогда тест ничего не докажет.
 * Контроль: node src/tools/control-eq-arrival.js
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

const TT_EQ_IN1_CH1 = 0x91; // полосы 1-2 канала 1
const PP_GAIN = 0x03; // gain полосы 1

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

  /** Полный снимок с периодическим ANNOUNCE — чтобы дождаться 0x91. */
  const snapshot = async (ms) => {
    const out = new Map();
    const t0 = Date.now();
    let lastKeep = 0;
    let lastAnn = 0;
    while (Date.now() - t0 < ms) {
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
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
      if (Date.now() - lastKeep >= 2000) {
        send(0x11, PP_SUBSCRIBE, 1);
        lastKeep = Date.now();
      }
      if (Date.now() - lastAnn >= 6000) {
        send(0x11, PP_ANNOUNCE, 1);
        lastAnn = Date.now();
      }
      await sleep(8);
    }
    return out;
  };

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  console.log('слушаю 26 с, чтобы дождаться блоков 0x91 (бюджет Prof)…');
  const before = await snapshot(26000);

  const key = `${hex2(TT_EQ_IN1_CH1)}:${hex2(PP_GAIN)}`;
  if (!before.has(key)) {
    console.log(`\n  0x${key} НЕ ПРИШЁЛ вообще.`);
    console.log('  Без исходного значения проверить запись нельзя.');
    console.log('  Возможно, устройство не в Prof-режиме или MCC держит поток.');
    h.close();
    process.exit(3);
  }

  const orig = before.get(key);
  console.log(`\n  исходный gain полосы 1 IN1 = ${orig}`);
  console.log(`  всего тегов в снимке: ${before.size}`);

  const target = orig === 3 ? -3 : 3;
  console.log(`\n  пишу 0x${key} = ${target} (прямой send, без окна EQ)…`);
  send(TT_EQ_IN1_CH1, PP_GAIN, target);
  await sleep(1500);

  console.log('  слушаю 26 с после записи…');
  const after = await snapshot(26000);
  const got = after.get(key);

  console.log(`\n  стало: ${got === undefined ? 'ТЕГ НЕ ПРИШЁЛ' : got}`);
  const accepted = got === target;
  console.log(`  ПРИНЯТО: ${accepted ? 'ДА' : 'НЕТ'}`);

  // откат
  console.log(`\n  возвращаю ${orig}…`);
  send(TT_EQ_IN1_CH1, PP_GAIN, orig);
  await sleep(1500);
  const back = await snapshot(26000);
  const restored = back.get(key);
  console.log(`  после отката: ${restored === undefined ? 'нет тега' : restored}`);
  console.log(`  откат: ${restored === orig ? 'ОК' : 'НЕ ОК'}`);

  h.close();

  console.log('\n' + '='.repeat(60));
  if (accepted) {
    console.log('ВЫВОД: EQ входов ПИШЕТСЯ через HID напрямую.');
    console.log('Значит серверный путь через UI MCC — устаревший, его можно');
    console.log('заменить и убрать зависимость от открытого окна EQ.');
  } else {
    console.log('НЕДОКАЗАНО.');
    console.log('');
    console.log('Тег не пришёл ни разу — ни до записи (тогда исходное');
    console.log('значение было бы undefined), ни после. По правилу §130');
    console.log('«undefined после записи = не увидели, а не отказано».');
    console.log('');
    console.log('Частая причина: MCC запущен и перехватывает HID-поток,');
    console.log('тогда приходит ~30 тегов вместо 177 и EQ-блоков нет вообще.');
    console.log('Сначала прогони контроль: node src/tools/control-eq-arrival.js');
    console.log('Если EQ не приходит и БЕЗ записи — метод негоден.');
  }
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
