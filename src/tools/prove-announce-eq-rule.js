/**
 * РЕШАЮЩИЙ ТЕСТ: ПРИХОДЯТ ЛИ EQ-БЛОКИ НА ПОВТОРНЫЙ ANNOUNCE?
 *
 * ═══ ПРОТИВОРЕЧИЕ, КОТОРОЕ НАДО ЗАКРЫТЬ ═══
 *
 * В коде и документации живут два взаимоисключающих утверждения:
 *
 *   A. src/eq-hid.js:40  — «устройство отдаёт блоки 0x91..0x94 ТОЛЬКО
 *      на первый ANNOUNCE в сессии; повторный announce в той же
 *      сессии EQ не возвращает (101 тег на первом, 46 на втором)»
 *
 *   B. src/transport-core.js:33 — «announce 0x11:0x26 каждые 15 с —
 *      без него EQ-блоки не приходят» (то есть повторный нужен!)
 *
 * Goldfish-ревью пометило это как Blocker: по такой паре правил
 * нельзя написать клиент, не угадывая.
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ ТЕСТ ═══
 *
 * В ОДНОЙ сессии:
 *   1. открывает её, шлёт announce -> считает EQ-адреса;
 *   2. шлёт announce ПОВТОРНО   -> считает EQ-адреса;
 *   3. шлёт announce ТРЕТИЙ раз -> считает EQ-адреса;
 *   4. закрывает и открывает НОВУЮ сессию -> считает EQ-адреса.
 *
 * Сравнение покажет, какое утверждение верно.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Только чтение: handshake, subscribe, announce. Ни одной записи
 * в параметры. Наушники не трогаются.
 *
 * Запуск: node src/tools/prove-announce-eq-rule.js
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

const isEqKey = (k) => /^(145|146|147|148):/.test(k);

/** Открыть свежую сессию. */
function openSession() {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  return { h, send };
}

/** Слить всё, что пришло за ms. Возвращает Map key->value. */
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
      out.set(`${f.target}:${f.prop}`, f.value);
    }
    // keepalive, чтобы карта не замолчала — но НЕ announce
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  return out;
}

function countEq(map) {
  return [...map.keys()].filter(isEqKey).length;
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ-БЛОКИ: ПЕРВЫЙ ANNOUNCE ИЛИ КАЖДЫЙ?');
  console.log('='.repeat(70));

  // ─── ОДНА ДЛИННАЯ СЕССИЯ, ТРИ ANNOUNCE ───
  console.log('\n--- сессия 1: три announce подряд ---');
  const { h, send } = openSession();

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);

  // announce #1
  send(0x11, PP_ANNOUNCE, 1);
  const d1 = await drain(h, send, 7000);
  const eq1 = countEq(d1);
  console.log(`  announce #1: всего адресов ${d1.size}, EQ-адресов ${eq1}`);

  // announce #2 — в ТОЙ ЖЕ сессии
  send(0x11, PP_ANNOUNCE, 1);
  const d2 = await drain(h, send, 7000);
  const eq2 = countEq(d2);
  console.log(`  announce #2: всего адресов ${d2.size}, EQ-адресов ${eq2}`);

  // announce #3 — в ТОЙ ЖЕ сессии
  send(0x11, PP_ANNOUNCE, 1);
  const d3 = await drain(h, send, 7000);
  const eq3 = countEq(d3);
  console.log(`  announce #3: всего адресов ${d3.size}, EQ-адресов ${eq3}`);

  try {
    h.close();
  } catch {
    /* ok */
  }
  await sleep(2000);

  // ─── НОВАЯ СЕССИЯ ───
  console.log('\n--- сессия 2: новая сессия, один announce ---');
  const s2 = openSession();
  s2.send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  s2.send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);
  s2.send(0x11, PP_ANNOUNCE, 1);
  const d4 = await drain(s2.h, s2.send, 8000);
  const eq4 = countEq(d4);
  console.log(`  новая сессия: всего адресов ${d4.size}, EQ-адресов ${eq4}`);
  try {
    s2.h.close();
  } catch {
    /* ok */
  }

  // ─── ВЕРДИКТ ───
  console.log('\n' + '='.repeat(70));
  console.log('ВЕРДИКТ');
  console.log('='.repeat(70));
  console.log(`  announce #1 (первый в сессии): EQ ${eq1}`);
  console.log(`  announce #2 (повтор):          EQ ${eq2}`);
  console.log(`  announce #3 (повтор):          EQ ${eq3}`);
  console.log(`  новая сессия (первый):         EQ ${eq4}`);

  const repeatsReturnEq = eq2 > 0 || eq3 > 0;
  console.log('');

  if (eq1 > 0 && !repeatsReturnEq) {
    console.log('  УТВЕРЖДЕНИЕ A ВЕРНО, B НЕВЕРНО:');
    console.log('  EQ приходит ТОЛЬКО на первый announce НОВОЙ сессии.');
    console.log('  Повторный announce в той же сессии EQ НЕ возвращает.');
    console.log('');
    console.log('  => Периодический announce (каждые 15 с) для EQ БЕСПОЛЕЗЕН.');
    console.log('  => Чтобы получить EQ повторно, нужна НОВАЯ СЕССИЯ.');
  } else if (repeatsReturnEq) {
    console.log('  УТВЕРЖДЕНИЕ B ВЕРНО: EQ приходит и на повторный announce.');
    console.log('  Значит периодический announce нужен и работает.');
    console.log('  => Запись в eq-hid.js про «только первый» — устарела.');
  } else if (eq1 === 0) {
    console.log('  EQ не пришёл даже на первом announce.');
    console.log('  Возможно, устройство не в том режиме (нужен Live или Prof).');
  }

  console.log(`\n  новая сессия дала EQ: ${eq4 > 0 ? 'ДА' : 'НЕТ'}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
