/**
 * ГЛАВНОЕ ОТКРЫТИЕ: ЗАПИСЬ EQ ПРИМЕНЯЕТСЯ, НО НЕ СРАЗУ.
 *
 * ═══ ЧТО НАБЛЮДАЛОСЬ ═══
 *
 * prove-eq-dump-sources.js:
 *   пишу 0x91:03 = 11
 *   слушаю 10 с (ничего не запрашивая)
 *   затем дамп -> 0x91:03 = 11   ПРИМЕНИЛОСЬ
 *
 * prove-eq-works.js (следующий прогон):
 *   исходное 0x91:03 = 11   <- значение с прошлого раза ОСТАЛОСЬ
 *   пишу 2 -> дамп сразу -> 11   не применилось
 *   пишу 4 -> дамп сразу -> 11   не применилось
 *   пишу 6 -> дамп сразу -> 11   не применилось
 *
 * Разница: в первом случае между записью и чтением было 10 с
 * простоя, во втором — дамп сразу.
 *
 * Это совпадает с внешним документом (NTMan/topping-m62):
 * «прошивка сама коммитит live-состояние после интервала простоя,
 * поэтому значение, записанное и тут же оборванное с шины, иногда
 * возвращается, а иногда нет».
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 * Пишет значение, ждёт N секунд, читает через дамп.
 * N = 0, 3, 6, 10, 15. Так видно, сколько нужно ждать.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Всё откатывается в конце.
 *
 * Запуск: node src/tools/prove-eq-commit-delay.js
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

/** Чтение только через дамп 0x11:26 + ожидание 0x11:25. */
async function readViaDump(ms = 10000) {
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

/** Пишет и ДЕРЖИТ соединение открытым N мс (простой), потом закрывает. */
async function writeAndHold(tt, pp, v, holdMs) {
  const { h, send } = open();
  await prepare(send);
  send(tt, pp, v);
  const t0 = Date.now();
  let lk = Date.now();
  // держим сессию живой, но БОЛЬШЕ НИЧЕГО не пишем
  while (Date.now() - t0 < holdMs) {
    for (let j = 0; j < 64; j++) {
      try {
        h.readTimeout(1);
      } catch {
        break;
      }
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1); // keepalive, не запись
      lk = Date.now();
    }
    await sleep(10);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(72));
  console.log('ЗАДЕРЖКА КОММИТА ЗАПИСИ EQ');
  console.log('='.repeat(72));

  const base = await readViaDump();
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  if (jack === 1 && mute0 !== 1) {
    await writeAndHold(0x64, 0x04, 1, 3000);
    const chk = await readViaDump(8000);
    if (chk.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  } else {
    console.log('  безопасно');
  }

  const s0 = await readViaDump();
  const before = s0.get('91:03');
  console.log(`\nисходное 0x91:03 = ${before}`);

  // ─── перебор задержек ───
  console.log('\n' + '-'.repeat(72));
  console.log('ПИШУ ЗНАЧЕНИЕ, ДЕРЖУ СЕССИЮ N мс, ЧИТАЮ ЧЕРЕЗ ДАМП');
  console.log('-'.repeat(72));

  const tests = [
    { hold: 500, value: 2 },
    { hold: 1000, value: 3 },
    { hold: 1500, value: 4 },
    { hold: 2000, value: 5 },
    { hold: 2500, value: 6 },
  ];

  const results = [];
  for (const t of tests) {
    console.log(`\nдержу ${t.hold / 1000} с, пишу gain = ${t.value}`);
    await writeAndHold(0x91, 0x03, t.value, t.hold);
    const r = await readViaDump();
    const got = r.get('91:03');
    const ok = got === t.value;
    console.log(`  дамп: ${got}   ${ok ? 'ПРИМЕНИЛОСЬ' : 'не применилось'}`);
    results.push({ hold: t.hold, value: t.value, got, ok });
    // между тестами — пауза, чтобы коммит успел пройти
    await sleep(2000);
  }

  // ─── откат к исходному ───
  console.log('\n' + '-'.repeat(72));
  console.log(`ОТКАТ к ${before}`);
  console.log('-'.repeat(72));
  await writeAndHold(0x91, 0x03, before ?? 0, 12000);
  const fin = await readViaDump();
  console.log(`  0x91:03 = ${fin.get('91:03')} (было ${before})`);

  console.log('\n' + '='.repeat(72));
  console.log('ИТОГ');
  console.log('='.repeat(72));
  console.log('  задержка   писали   получили   результат');
  for (const r of results) {
    console.log(
      `  ${String(r.hold / 1000).padStart(5)} с   ${String(r.value).padStart(6)}   `
      + `${String(r.got).padStart(8)}   ${r.ok ? 'ПРИМЕНЕНО' : '-'}`,
    );
  }
  const okList = results.filter((r) => r.ok);
  console.log('');
  if (okList.length) {
    const minHold = Math.min(...okList.map((r) => r.hold));
    console.log(`  МИНИМАЛЬНАЯ РАБОЧАЯ ЗАДЕРЖКА: ${minHold / 1000} с`);
    console.log('  Значит запись EQ применяется, но НЕ МГНОВЕННО.');
    console.log('  Читать результат нужно:');
    console.log('    1) после паузы (не обрывать сессию сразу),');
    console.log('    2) через дамп 0x11:26 с ожиданием 0x11:25.');
  } else {
    console.log('  Ни одна задержка не помогла.');
    console.log('  Но значение 11 из прошлого теста ПРИМЕНИЛОСЬ —');
    console.log('  значит механизм есть, надо искать условие.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});

