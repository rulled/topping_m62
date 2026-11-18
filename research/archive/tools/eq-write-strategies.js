/**
 * ТРИ СТРАТЕГИИ ЗАПИСИ EQ ЧЕРЕЗ HID — за один проход.
 *
 * ═══ ЧТО УЖЕ ИЗВЕСТНО ═══
 *
 * Простая запись `send(0x91, 0x03, 3)` с проверкой в НОВОЙ сессии
 * НЕ применилась (тест eq-write-definitive.js: 0 -> пишем 3 -> читаем 0).
 * Замер чистый: 177 тегов, 40 EQ-тегов, кэша нет (переподключение).
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Микшер пишется ТОЛЬКО внутри bulk-push брекета:
 *     0x11:0x20 = 1 ... кадры ... 0x11:0x20 = 0 ... 0x11:0x26 = 1
 * Одиночные записи в микшер устройство игнорирует (проверено).
 *
 * Возможно, EQ ведёт себя так же. Проверяем три способа:
 *
 *   A. одиночная запись           (уже провалилась, для контроля)
 *   B. запись внутри брекета 0x11:0x20
 *   C. запись + сохранение 0x11:0x05
 *
 * Каждая проверяется в СВЕЖЕЙ сессии (переподключение сбрасывает кэш).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется только gain полосы 1 EQ входа IN1, в пределах -3..+3 дБ,
 * с откатом. Наушники и OTG проверяются.
 *
 * Запуск: node src/tools/eq-write-strategies.js
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
  PP_SAVE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const TT = 0x91;
const PP = 0x03;
const KEY = '91:03';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function freshSnapshot(label, ms = 20000) {
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
  console.log(`  ${label}: тегов=${out.size}, 0x${KEY}=${out.get(KEY) ?? '—'}`);
  return out;
}

/** Стратегия A: одиночная запись. */
async function strategyPlain(value) {
  const h = new HID.HID(findDev().path);
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

/** Стратегия B: внутри bulk-push брекета (как микшер). */
async function strategyBracket(value) {
  const h = new HID.HID(findDev().path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 1); // открыть
  await sleep(50);
  send(TT, PP, value);
  await sleep(50);
  send(0x11, PP_BULK_BEGIN, 0); // закрыть
  await sleep(100);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(1500);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

/** Стратегия C: запись + команда сохранения. */
async function strategySave(value) {
  const h = new HID.HID(findDev().path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(TT, PP, value);
  await sleep(300);
  send(0x11, PP_SAVE, 1);
  await sleep(1500);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('СЕССИЯ 0: исходное состояние');
  const s0 = await freshSnapshot('до');

  const hp = s0.get('64:06');
  const otg = s0.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log('\nОСТАНОВ: джек подключён.');
    process.exit(2);
  }
  const orig = s0.get(KEY);
  if (orig === undefined) {
    console.log(`\n0x${KEY} не пришёл — проверять нечего.`);
    process.exit(3);
  }
  console.log(`\nисходный 0x${KEY} = ${orig}\n`);

  const results = [];
  const target = orig === 3 ? -3 : 3;

  const run = async (name, fn, value) => {
    console.log(`── ${name} (пишем ${value}) ──`);
    await fn(value);
    await sleep(2000);
    const s = await freshSnapshot('  после');
    const got = s.get(KEY);
    const ok = got === value;
    results.push({ name, value, got, ok });
    console.log(`  ${ok ? 'ПРИНЯТО' : 'не принято'}\n`);
    // откат, если принялось
    if (ok) {
      await strategyPlain(orig);
      await sleep(2000);
      const b = await freshSnapshot('  откат');
      console.log(`  откат: ${b.get(KEY) === orig ? 'ОК' : 'проверь'} \n`);
    }
    return ok;
  };

  await run('A. одиночная запись', strategyPlain, target);
  await run('B. внутри брекета 0x11:0x20', strategyBracket, target);
  await run('C. запись + сохранение 0x11:0x05', strategySave, target);

  console.log('═'.repeat(62));
  console.log('ИТОГ');
  console.log('═'.repeat(62));
  for (const r of results) {
    console.log(`  ${r.name.padEnd(32)} ${r.ok ? 'РАБОТАЕТ' : 'не работает'}`
      + ` (ждали ${r.value}, получили ${r.got ?? '—'})`);
  }
  const any = results.some((r) => r.ok);
  console.log('');
  if (any) {
    console.log('  EQ входов ПИШЕТСЯ через HID одной из стратегий.');
    console.log('  => бекенд можно перевести на HID.');
  } else {
    console.log('  Ни одна стратегия не сработала.');
    console.log('  => EQ входов через HID не пишется, UI-путь обязателен.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
