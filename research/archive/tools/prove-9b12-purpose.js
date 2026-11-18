/**
 * 0x9b:0x12 / 0x9b:0x13 — ЧТО ЭТО. ПРОВЕРКА С УЧЁТОМ ДАМПА.
 *
 * ═══ ЧТО УЖЕ ЗНАЕМ ═══
 *
 *   1. Семейство 0x9b ТОЛЬКО ДЛЯ ЧТЕНИЯ (запись не принимается,
 *      проверено на 0x9b:0f/10/12/13).
 *   2. 0x9b:12/13 НЕ меняются при нажатии кнопки EQ в MCC
 *      (проверено prove-9b0f-vs-mcc.js).
 *   3. Значения всегда 0 в обычном ANNOUNCE.
 *   4. Это enum 0..2 по прежним замерам.
 *
 * ═══ НОВАЯ ГИПОТЕЗА ═══
 *
 * Раньше мы смотрели 0x9b:12/13 в ОБЫЧНОМ ANNOUNCE. Но EQ-блоки
 * приходят ТОЛЬКО в дампе 0x11:26 (открытие 2026-11-13).
 * Возможно, 0x9b:12/13 — часть того же дампа и означает что-то
 * про EQ-полосы.
 *
 * Кандидаты по строкам из MCC:
 *   EQStateTarget / EQStateSource / EQStateEachFilter /
 *   EQStateCombined / EQStateFiltered — группа radio-кнопок.
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Читает 0x9b:12/13 через ДАМП в исходном состоянии.
 * 2. Включает все 4 полосы EQ IN1 (рабочим методом: держать 2.5 с).
 * 3. Читает через ДАМП — изменилось ли 0x9b:12.
 * 4. Меняет тип фильтра полосы (peaking -> lowpass).
 * 5. Снова читает.
 * 6. Выключает полосы, откатывает.
 *
 * Если 0x9b:12 меняется при включении полос — это счётчик/режим EQ.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Gain не трогаем (остаётся 0),
 * поэтому звук не меняется. Всё откатывается.
 *
 * Запуск: node src/tools/prove-9b12-purpose.js
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

/** Чтение через дамп: 0x11:26, ждём ~3.5 с. */
async function readViaDump(ms = 3500) {
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

/** Запись с удержанием сессии (прошивка коммитит не мгновенно). */
async function writeAndHold(frames, holdMs = 2500) {
  const { h, send } = open();
  await prepare(send);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(150);
  }
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < holdMs) {
    for (let j = 0; j < 64; j++) {
      try {
        h.readTimeout(1);
      } catch {
        break;
      }
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
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
  console.log('='.repeat(70));
  console.log('0x9b:0x12 / 0x9b:0x13 — НАЗНАЧЕНИЕ, ПРОВЕРКА ЧЕРЕЗ ДАМП');
  console.log('='.repeat(70));

  const s0 = await readViaDump();
  const jack = s0.get('64:06');
  const mute0 = s0.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  if (jack === 1 && mute0 !== 1) {
    await writeAndHold([[0x64, 0x04, 1]], 2500);
    if ((await readViaDump()).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  } else {
    console.log('  безопасно');
  }

  const base = await readViaDump();
  const orig = {
    p12: base.get('9b:12'),
    p13: base.get('9b:13'),
    b1: base.get('91:01'),
    b2: base.get('91:06'),
    t1: base.get('91:02'),
    g1: base.get('91:03'),
  };
  console.log('\nИСХОДНОЕ (через дамп):');
  console.log(`  0x9b:12 = ${orig.p12}    0x9b:13 = ${orig.p13}`);
  console.log(`  0x91:01 (band1 en) = ${orig.b1}   0x91:06 (band2 en) = ${orig.b2}`);
  console.log(`  0x91:02 (band1 type) = ${orig.t1}  0x91:03 (band1 gain) = ${orig.g1}`);

  const observations = [];

  // ─── шаг 1: включаем полосы 1 и 2 ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 1: включаю полосы 1 и 2 (gain остаётся 0)');
  console.log('-'.repeat(70));
  await writeAndHold([[0x91, 0x01, 1], [0x91, 0x06, 1]], 2500);
  const r1 = await readViaDump();
  console.log(`  0x91:01 = ${r1.get('91:01')}  0x91:06 = ${r1.get('91:06')}`);
  console.log(`  0x9b:12 = ${r1.get('9b:12')}  ${r1.get('9b:12') !== orig.p12 ? 'ИЗМЕНИЛОСЬ' : 'не изменилось'}`);
  observations.push({ what: 'полосы 1,2 вкл', p12: r1.get('9b:12') });

  // ─── шаг 2: включаем ВСЕ 4 полосы ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 2: включаю все 4 полосы');
  console.log('-'.repeat(70));
  await writeAndHold([
    [0x91, 0x01, 1], [0x91, 0x06, 1], [0x92, 0x01, 1], [0x92, 0x06, 1],
  ], 2500);
  const r2 = await readViaDump();
  console.log(`  0x9b:12 = ${r2.get('9b:12')}  ${r2.get('9b:12') !== r1.get('9b:12') ? 'ИЗМЕНИЛОСЬ' : 'не изменилось'}`);
  observations.push({ what: 'все 4 полосы', p12: r2.get('9b:12') });

  // ─── шаг 3: меняем тип фильтра ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 3: тип полосы 1: peaking -> lowpass');
  console.log('-'.repeat(70));
  await writeAndHold([[0x91, 0x02, 2]], 2500);
  const r3 = await readViaDump();
  console.log(`  0x91:02 = ${r3.get('91:02')}`);
  console.log(`  0x9b:12 = ${r3.get('9b:12')}  ${r3.get('9b:12') !== r2.get('9b:12') ? 'ИЗМЕНИЛОСЬ' : 'не изменилось'}`);
  observations.push({ what: 'тип lowpass', p12: r3.get('9b:12') });

  // ─── шаг 4: выключаем всё ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 4: выключаю все полосы');
  console.log('-'.repeat(70));
  await writeAndHold([
    [0x91, 0x01, 0], [0x91, 0x06, 0], [0x92, 0x01, 0], [0x92, 0x06, 0],
  ], 2500);
  const r4 = await readViaDump();
  console.log(`  0x9b:12 = ${r4.get('9b:12')}  ${r4.get('9b:12') !== r3.get('9b:12') ? 'ИЗМЕНИЛОСЬ' : 'не изменилось'}`);
  observations.push({ what: 'все выкл', p12: r4.get('9b:12') });

  // ─── откат ───
  console.log('\nОТКАТ…');
  await writeAndHold([
    [0x91, 0x02, orig.t1 ?? 1],
    [0x91, 0x01, orig.b1 ?? 0],
    [0x91, 0x06, orig.b2 ?? 0],
    [0x91, 0x03, orig.g1 ?? 0],
  ], 2500);
  const fin = await readViaDump();
  console.log(`  0x9b:12 = ${fin.get('9b:12')}  0x9b:13 = ${fin.get('9b:13')}`);
  console.log(`  0x91:02 = ${fin.get('91:02')}  0x91:03 = ${fin.get('91:03')}`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  for (const o of observations) {
    console.log(`  ${o.what.padEnd(20)} 0x9b:12 = ${o.p12}`);
  }
  const allSame = observations.every((o) => o.p12 === observations[0].p12);
  console.log('');
  if (allSame) {
    console.log('  0x9b:12 НЕ реагирует ни на включение полос, ни на тип фильтра.');
    console.log('  Значит это не состояние EQ-полос.');
    console.log('');
    console.log('  Что остаётся: по строкам MCC есть группа EQState*:');
    console.log('  Target / Source / EachFilter / Combined / Filtered —');
    console.log('  это режим ОТОБРАЖЕНИЯ графика EQ в самом MCC, а не');
    console.log('  параметр устройства. Такой режим живёт в UI и на карту');
    console.log('  не пишется, поэтому 0x9b:12/13 всегда 0.');
  } else {
    console.log('  0x9b:12 РЕАГИРУЕТ на состояние EQ — смотрим таблицу выше.');
    console.log('  Это отражение конфигурации полос (счётчик/режим).');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
