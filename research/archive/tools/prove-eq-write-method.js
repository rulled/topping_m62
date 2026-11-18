/**
 * ПОЧЕМУ ЗАПИСЬ EQ ПЕРЕСТАЛА ПРИНИМАТЬСЯ?
 *
 * ═══ ПРОТИВОРЕЧИЕ ═══
 *
 *   NOTES §135.2 (2026-11-10): 7 из 7 записей EQ приняты
 *       0x91:01 0 -> 1   принято
 *       0x91:02 1 -> 2   принято
 *       0x91:03 0 -> 3   принято
 *       ...
 *       0x9b:0f 0 -> 1   принято
 *
 *   сегодня (2026-11-13), MCC закрыт:
 *       0x9b:0f 0 -> 1   НЕ принято
 *       0x91:01 0 -> 1   НЕ принято
 *       0x91:06 0 -> 1   НЕ принято
 *       0x93:01 0 -> 1   НЕ принято
 *
 * Ни один тег не принимается, даже те, что раньше работали.
 * Значит дело не в конкретном адресе, а в МЕТОДЕ.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 *   H1. Изменения откатываются при закрытии сессии. Нужен
 *       `0x11:0x05` (save) перед закрытием.
 *   H2. Нужен брекет `0x11:0x20` (begin) ... `0x11:0x20`=0 (end),
 *       как для микшера.
 *   H3. Читать надо в ТОЙ ЖЕ сессии (а не в новой) — устройство
 *       отдаёт 0x91..0x94 только на первый ANNOUNCE.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Проверяет все три гипотезы по очереди на ОДНОМ теге (0x91:03 gain),
 * потому что он числовой и явно отличим (0 vs 3).
 *
 *   Способ 1: запись -> закрыть -> новая сессия   (как сейчас)
 *   Способ 2: запись -> save 0x11:05 -> закрыть -> новая сессия
 *   Способ 3: запись -> читать В ТОЙ ЖЕ сессии
 *   Способ 4: брекет 0x11:20=1 -> запись -> 0x11:20=0 -> новая сессия
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Gain 0 -> 3 дБ — небольшое
 * усиление, наушники отключены по проверке выше.
 *
 * Запуск: node src/tools/prove-eq-write-method.js
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
const PROBE = { tt: 0x91, pp: 0x03 }; // band1 gain IN1
const TEST_VALUE = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

function openSession() {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  return { h, send };
}

async function handshake(send) {
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(600);
}

/** Дренаж сокета в течение ms, возвращает Map адрес->значение. */
async function drain(h, send, ms) {
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
  return out;
}

/** Прочитать значение в НОВОЙ сессии. */
async function readFresh(ms = 9000) {
  const { h, send } = openSession();
  await handshake(send);
  const out = await drain(h, send, ms);
  try {
    h.close();
  } catch {
    /* ok */
  }
  return out.get(`${hex2(PROBE.tt)}:${hex2(PROBE.pp)}`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('ПОЧЕМУ ЗАПИСЬ EQ НЕ ПРИНИМАЕТСЯ — ПРОВЕРКА 4 СПОСОБОВ');
  console.log('='.repeat(70));
  console.log(`тестовый тег: 0x${hex2(PROBE.tt)}:0x${hex2(PROBE.pp)} (band1 gain IN1)`);
  console.log(`пишем значение: ${TEST_VALUE}`);

  const orig = await readFresh();
  console.log(`\nисходное значение: ${orig}`);

  // ─── СПОСОБ 1: запись -> закрыть -> читать в новой сессии ───
  console.log('\n' + '-'.repeat(70));
  console.log('СПОСОБ 1: запись -> закрыть -> новая сессия (текущий метод)');
  console.log('-'.repeat(70));
  {
    const { h, send } = openSession();
    await handshake(send);
    send(PROBE.tt, PROBE.pp, TEST_VALUE);
    await sleep(1200);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1200);
  const r1 = await readFresh();
  console.log(`  результат: ${r1}   ${r1 === TEST_VALUE ? 'ПРИНЯТО' : 'НЕ принято'}`);

  // откат
  {
    const { h, send } = openSession();
    await handshake(send);
    send(PROBE.tt, PROBE.pp, orig ?? 0);
    await sleep(800);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1000);

  // ─── СПОСОБ 2: запись -> SAVE 0x11:05 -> закрыть ───
  console.log('\n' + '-'.repeat(70));
  console.log('СПОСОБ 2: запись -> save 0x11:05 -> закрыть -> новая сессия');
  console.log('-'.repeat(70));
  {
    const { h, send } = openSession();
    await handshake(send);
    send(PROBE.tt, PROBE.pp, TEST_VALUE);
    await sleep(900);
    send(0x11, 0x05, 1); // SAVE
    await sleep(1500);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1500);
  const r2 = await readFresh();
  console.log(`  результат: ${r2}   ${r2 === TEST_VALUE ? 'ПРИНЯТО' : 'НЕ принято'}`);

  // откат + save
  {
    const { h, send } = openSession();
    await handshake(send);
    send(PROBE.tt, PROBE.pp, orig ?? 0);
    await sleep(800);
    send(0x11, 0x05, 1);
    await sleep(1200);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1200);

  // ─── СПОСОБ 3: запись -> читать В ТОЙ ЖЕ сессии ───
  console.log('\n' + '-'.repeat(70));
  console.log('СПОСОБ 3: запись -> читать В ТОЙ ЖЕ сессии');
  console.log('-'.repeat(70));
  {
    const { h, send } = openSession();
    await handshake(send);
    send(PROBE.tt, PROBE.pp, TEST_VALUE);
    await sleep(1200);
    // новое ANNOUNCE в той же сессии
    send(0x11, PP_ANNOUNCE, 1);
    const got = await drain(h, send, 8000);
    const v = got.get(`${hex2(PROBE.tt)}:${hex2(PROBE.pp)}`);
    console.log(`  результат: ${v}   ${v === TEST_VALUE ? 'ПРИНЯТО' : 'НЕ принято'}`);
    send(PROBE.tt, PROBE.pp, orig ?? 0);
    await sleep(800);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1200);

  // ─── СПОСОБ 4: брекет 0x11:20 ───
  console.log('\n' + '-'.repeat(70));
  console.log('СПОСОБ 4: брекет 0x11:20=1 -> запись -> 0x11:20=0 -> новая сессия');
  console.log('-'.repeat(70));
  {
    const { h, send } = openSession();
    await handshake(send);
    send(0x11, 0x20, 1); // begin
    await sleep(500);
    send(PROBE.tt, PROBE.pp, TEST_VALUE);
    await sleep(500);
    send(0x11, 0x20, 0); // end
    await sleep(1500);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }
  await sleep(1500);
  const r4 = await readFresh();
  console.log(`  результат: ${r4}   ${r4 === TEST_VALUE ? 'ПРИНЯТО' : 'НЕ принято'}`);

  // откат
  {
    const { h, send } = openSession();
    await handshake(send);
    send(0x11, 0x20, 1);
    await sleep(400);
    send(PROBE.tt, PROBE.pp, orig ?? 0);
    await sleep(400);
    send(0x11, 0x20, 0);
    await sleep(1000);
    try {
      h.close();
    } catch {
      /* ok */
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const rows = [
    ['1: запись -> новая сессия', r1],
    ['2: запись + save 0x11:05', r2],
    ['4: брекет 0x11:20', r4],
  ];
  for (const [name, got] of rows) {
    console.log(`  ${name.padEnd(34)} -> ${got}  ${got === TEST_VALUE ? 'РАБОТАЕТ' : '-'}`);
  }
  const winner = rows.find(([, got]) => got === TEST_VALUE);
  console.log('');
  if (winner) {
    console.log(`  РАБОЧИЙ СПОСОБ: ${winner[0]}`);
    console.log('  Значит прежний метод записи был неполным.');
  } else {
    console.log('  Ни один способ не сработал в новой сессии.');
    console.log('  Смотрим способ 3 (чтение в той же сессии) выше —');
    console.log('  возможно, устройство просто не отдаёт 0x91 повторно,');
    console.log('  и запись на самом деле применяется.');
  }
  console.log(`\nисходное значение было: ${orig}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
