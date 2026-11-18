/**
 * РЕШАЮЩИЙ ОПЫТ: пишется ли EQ входов через HID — с ПЕРЕПОДКЛЮЧЕНИЕМ.
 *
 * ═══ ПОЧЕМУ ЭТОТ ОПЫТ НУЖЕН ═══
 *
 * В журнале два противоречащих замера:
 *
 *   §116  probe-hid-write-matrix.js -> 0 из 4 (компрессор/EQ/реверб)
 *   §123  запись 0x91:03 = 5        -> принято, 8 из 8
 *
 * Оба не могут быть верны. Разница, скорее всего, в методе.
 *
 * PROTOCOL.md §5.0, ошибка №2: «Обратное чтение в той же сессии
 * показывает кэш. Нужен свежий дамп — с ПЕРЕПОДКЛЮЧЕНИЕМ.»
 *
 * Мой прошлый тест (test-eq-input-hid-write.js) писал и читал
 * В ОДНОЙ СЕССИИ — и не увидел ни старого, ни нового значения.
 * Плюс MCC в трее делает второй снимок «тонким» (30 тегов вместо 177).
 *
 * Здесь: снимок -> запись -> ЗАКРЫТЬ HID -> ОТКРЫТЬ ЗАНОВО -> снимок.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется gain полосы 1 EQ входа IN1 на ±3 дБ и возвращается.
 * Наушники и OTG должны быть отключены — проверяется.
 *
 * Запуск: node src/tools/eq-write-definitive.js
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
const TT = 0x91; // EQ IN1, полосы 1-2
const PP = 0x03; // gain полосы 1
const KEY = '91:03';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

/** Открывает сессию и снимает полный дамп. Возвращает Map и закрывает HID. */
async function freshSnapshot(label, ms = 26000) {
  const dev = findDev();
  if (!dev) throw new Error('M62 iface 4 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = 0;
  let la = 0;
  let eqAt = null;

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
      if (eqAt === null && f.target >= 0x91 && f.target <= 0x94) {
        eqAt = ((Date.now() - t0) / 1000).toFixed(1);
      }
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
  const eqCount = [...out.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  console.log(`  ${label}: тегов=${out.size}, EQ-входов=${eqCount},`
    + ` 0x${KEY}=${out.get(KEY) ?? '—'}, первый EQ на ${eqAt ?? '—'} с`);
  return out;
}

/** Открывает сессию, пишет одно значение, закрывает. */
async function writeAndClose(value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(TT, PP, value);
  await sleep(1500);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('═'.repeat(64));
  console.log('СЕССИЯ 1: исходное состояние');
  console.log('═'.repeat(64));
  const before = await freshSnapshot('до');

  // безопасность: джеки
  const hp = before.get('64:06');
  const otg = before.get('62:06');
  console.log(`\n  наушники 0x64:06=${hp ?? '?'}  OTG 0x62:06=${otg ?? '?'}`);
  if (hp === 1 || otg === 1) {
    console.log('  ОСТАНОВ: джек подключён, тест со звуком запрещён.');
    process.exit(2);
  }

  if (!before.has(KEY)) {
    console.log(`\n  0x${KEY} не пришёл даже в чистой сессии.`);
    console.log('  Проверить запись нельзя: нет исходного значения.');
    console.log('  Возможно, устройство не в Prof-режиме.');
    process.exit(3);
  }

  const orig = before.get(KEY);
  const target = orig === 3 ? -3 : 3;
  console.log(`\n  исходный 0x${KEY} = ${orig}`);
  console.log(`  пишу ${target} и ЗАКРЫВАЮ соединение (сброс кэша)`);
  await writeAndClose(target);

  console.log('\n' + '═'.repeat(64));
  console.log('СЕССИЯ 2: что стало (свежее подключение)');
  console.log('═'.repeat(64));
  await sleep(2000);
  const after = await freshSnapshot('после');

  const got = after.get(KEY);
  const accepted = got === target;
  console.log(`\n  0x${KEY}: ${orig} -> записали ${target} -> видим ${got ?? 'ТЕГ НЕ ПРИШЁЛ'}`);
  console.log(`  ЗАПИСЬ ЧЕРЕЗ HID: ${accepted ? 'РАБОТАЕТ' : 'НЕ РАБОТАЕТ'}`);

  // откат
  if (got !== undefined && got !== orig) {
    console.log(`\n  возвращаю ${orig}…`);
    await writeAndClose(orig);
    await sleep(2000);
    const back = await freshSnapshot('откат');
    console.log(`  откат: ${back.get(KEY) === orig ? 'ОК' : 'проверь вручную'}`);
  }

  console.log('\n' + '═'.repeat(64));
  console.log('ИТОГ');
  console.log('═'.repeat(64));
  if (accepted) {
    console.log('  HID ПИШЕТ EQ входов. §123 верен, §116 — ошибка метода.');
    console.log('  => бекенд можно перевести с UI на HID, MCC станет не нужен.');
  } else {
    console.log('  HID НЕ пишет EQ входов даже с переподключением.');
    console.log('  => §123 был ошибочным замером, UI-путь через MCC обязателен.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
