/**
 * ПОДТВЕРЖДЕНИЕ: ЗАПИСЬ EQ РАБОТАЕТ, ЧИТАТЬ НАДО ЧЕРЕЗ ДАМП 0x11:26.
 *
 * ═══ ОТКРЫТИЕ (2026-11-13) ═══
 *
 * `prove-eq-dump-sources.js` показал:
 *
 *   пишу 0x91:03 = 11
 *   обычный ANNOUNCE -> 0x91:03 не пришёл вообще
 *   явный 0x11:26 + ожидание 0x11:25 -> 0x91:03 = 11  ПРИМЕНИЛОСЬ
 *                                      (дамп пришёл на 2740 мс)
 *
 * То есть девять прежних проверок были мимо не потому, что запись
 * не работает, а потому, что читали НЕ ТОТ ИСТОЧНИК.
 *
 * Правило карты: блоки EQ (0x91..0x94, 0xa1..0xaa) приходят ТОЛЬКО
 * в ответ на 0x11:26, и дамп завершается 0x11:25. Обычный ANNOUNCE
 * их не несёт (кроме самого первого в сессии, и то не всегда).
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Три разных значения подряд, каждое читается через дамп.
 * 2. Все 5 полей полосы: enable/type/gain/freq/q.
 * 3. Второй канал IN2 (0x93).
 * 4. Чтение после записи — обязательно через дамп.
 * 5. Всё откатывается.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением (читаем jack/mute через дамп,
 * чтобы не пропустить). Gain до 4 дБ на одной полосе безобиден.
 *
 * Запуск: node src/tools/prove-eq-works.js
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

/**
 * ГЛАВНАЯ ФУНКЦИЯ: читает состояние ЧЕРЕЗ ДАМП.
 * Шлёт 0x11:26, ждёт 0x11:25, собирает все кадры.
 */
async function readViaDump(ms = 12000) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
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
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      if (f.target === 0x11 && f.prop === 0x25 && terminatorAt === null) {
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
  out.set('__terminatorMs', terminatorAt);
  return out;
}

async function writeOne(tt, pp, v) {
  const { h, send } = open();
  await prepare(send);
  send(tt, pp, v);
  await sleep(900);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('ЗАПИСЬ EQ РАБОТАЕТ — ЧТЕНИЕ ТОЛЬКО ЧЕРЕЗ ДАМП 0x11:26');
  console.log('='.repeat(70));

  const base = await readViaDump();
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  console.log(`дамп завершился на ${base.get('__terminatorMs')} мс`);

  if (jack === 1 && mute0 !== 1) {
    await writeOne(0x64, 0x04, 1);
    const chk = await readViaDump(8000);
    if (chk.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено и подтверждено');
  } else {
    console.log('  безопасно');
  }

  const s0 = await readViaDump();
  const orig = {
    en1: s0.get('91:01'),
    ty1: s0.get('91:02'),
    g1: s0.get('91:03'),
    f1: s0.get('91:04'),
    q1: s0.get('91:05'),
    en2: s0.get('93:01'),
    g2: s0.get('93:03'),
  };
  console.log('\nисходное (через дамп):');
  console.log(`  0x91:01=${orig.en1}  0x91:02=${orig.ty1}  0x91:03=${orig.g1}`);
  console.log(`  0x91:04=${orig.f1}   0x91:05=${orig.q1}`);
  console.log(`  0x93:01=${orig.en2}  0x93:03=${orig.g2}`);

  const results = [];

  // ─── 1: три значения gain подряд ───
  console.log('\n' + '-'.repeat(70));
  console.log('1: три значения gain подряд (чтение через дамп)');
  console.log('-'.repeat(70));
  for (const target of [2, 4, 6]) {
    await writeOne(0x91, 0x03, target);
    const r = await readViaDump();
    const got = r.get('91:03');
    const ok = got === target;
    console.log(`  пишу ${target} -> дамп показывает ${got}   ${ok ? 'ПРИМЕНЕНО' : 'нет'}`);
    results.push({ label: `gain=${target}`, ok });
    await sleep(600);
  }

  // ─── 2: все поля полосы ───
  console.log('\n' + '-'.repeat(70));
  console.log('2: все поля полосы 1');
  console.log('-'.repeat(70));
  const want = { en1: 1, ty1: 2, g1: 5, f1: 1000, q1: 10000 };
  await writeOne(0x91, 0x01, want.en1);
  await writeOne(0x91, 0x02, want.ty1);
  await writeOne(0x91, 0x03, want.g1);
  await writeOne(0x91, 0x04, want.f1);
  await writeOne(0x91, 0x05, want.q1);
  const rAll = await readViaDump();
  const checks = [
    ['enable', rAll.get('91:01'), want.en1],
    ['type', rAll.get('91:02'), want.ty1],
    ['gain', rAll.get('91:03'), want.g1],
    ['freq', rAll.get('91:04'), want.f1],
    ['q', rAll.get('91:05'), want.q1],
  ];
  for (const [name, got, w] of checks) {
    const ok = got === w;
    console.log(`  ${name.padEnd(8)} -> ${String(got).padStart(6)} (хотели ${String(w).padStart(6)})  ${ok ? 'OK' : '-'}`);
    results.push({ label: `поле ${name}`, ok });
  }

  // ─── 3: второй канал ───
  console.log('\n' + '-'.repeat(70));
  console.log('3: второй канал IN2 (0x93)');
  console.log('-'.repeat(70));
  await writeOne(0x93, 0x03, 7);
  const r2 = await readViaDump();
  const g2 = r2.get('93:03');
  const ok2 = g2 === 7;
  console.log(`  0x93:03 -> ${g2}   ${ok2 ? 'ПРИМЕНЕНО' : 'нет'}`);
  results.push({ label: 'IN2 gain=7', ok: ok2 });

  // ─── откат ───
  console.log('\n' + '-'.repeat(70));
  console.log('ОТКАТ');
  console.log('-'.repeat(70));
  await writeOne(0x91, 0x01, orig.en1 ?? 0);
  await writeOne(0x91, 0x02, orig.ty1 ?? 1);
  await writeOne(0x91, 0x03, orig.g1 ?? 0);
  await writeOne(0x91, 0x04, orig.f1 ?? 632);
  await writeOne(0x91, 0x05, orig.q1 ?? 7000);
  await writeOne(0x93, 0x03, orig.g2 ?? 0);
  const fin = await readViaDump();
  console.log(`  0x91:03 = ${fin.get('91:03')} (было ${orig.g1})`);
  console.log(`  0x91:04 = ${fin.get('91:04')} (было ${orig.f1})`);
  console.log(`  0x93:03 = ${fin.get('93:03')} (было ${orig.g2})`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const okCount = results.filter((r) => r.ok).length;
  for (const r of results) {
    console.log(`  ${r.label.padEnd(18)} ${r.ok ? 'РАБОТАЕТ' : 'нет'}`);
  }
  console.log(`\n  прошло: ${okCount} из ${results.length}`);
  console.log('');
  if (okCount === results.length) {
    console.log('  ЗАПИСЬ EQ ПОЛНОСТЬЮ РАБОТАЕТ.');
    console.log('  Правило: писать можно обычным кадром, а ЧИТАТЬ результат');
    console.log('  только через дамп 0x11:26 с ожиданием 0x11:25 (~2.7 с).');
    console.log('  Прежние 9 «не работает» — ошибка чтения, не записи.');
  } else {
    console.log('  Работает частично — смотрим таблицу.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
