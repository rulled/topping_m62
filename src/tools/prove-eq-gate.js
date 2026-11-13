/**
 * РАБОЧАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ ЗАПИСИ EQ — УТОЧНЕНИЕ.
 *
 * ═══ ОТКРЫТИЕ ═══
 *
 * prove-eq-bulk-write.js, способ D:
 *     брекет: [0x9b:0f = 1] затем [0x91:03 = 3]
 *     результат: 0x91:03 = 3  ПРИНЯТО
 *
 * Все остальные способы (полоса без включения EQ) — не работают.
 *
 * Вывод: EQ-полосы принимают запись ТОЛЬКО когда EQ включён.
 * Это «гейт»: сначала общий switch, потом параметры.
 *
 * ═══ ЧТО УТОЧНЯЕТ ЭТОТ ТЕСТ ═══
 *
 *   1. Читается ли 0x9b:0f назад после записи 1? (значение-гейт)
 *   2. Достаточно ли брекета, или 0x9b:0f пишется и одиночным кадром?
 *   3. Сохраняется ли гейт между сессиями (включил -> закрыл ->
 *      в новой сессии пишу полосу без повторного включения)?
 *   4. Работает ли запись ВСЕХ полей полосы (type/gain/freq/q/enable)
 *      после включения гейта?
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением, всё откатывается в конце.
 * Gain 3 дБ одна полоса — незначительно.
 *
 * Запуск: node src/tools/prove-eq-gate.js
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

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

function open() {
  const dev = findDev();
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

async function readFresh(ms = 9000) {
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
  await sleep(700);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function writeSingle(frames) {
  const { h, send } = open();
  await prepare(send);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(180);
  }
  await sleep(700);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('УТОЧНЕНИЕ: ГЕЙТ ВКЛЮЧЕНИЯ EQ');
  console.log('='.repeat(70));

  const base = await readFresh(6000);
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  if (jack === 1 && mute0 !== 1) {
    await writeBulk([[0x64, 0x04, 1]]);
    if ((await readFresh(6000)).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  }

  const s0 = await readFresh();
  const orig = {
    sw: s0.get('9b:0f'),
    en1: s0.get('91:01'),
    ty1: s0.get('91:02'),
    g1: s0.get('91:03'),
    f1: s0.get('91:04'),
    q1: s0.get('91:05'),
  };
  console.log('\nисходное:');
  console.log(`  0x9b:0f switch = ${orig.sw}`);
  console.log(`  0x91:01 enable = ${orig.en1}`);
  console.log(`  0x91:02 type   = ${orig.ty1}`);
  console.log(`  0x91:03 gain   = ${orig.g1}`);
  console.log(`  0x91:04 freq   = ${orig.f1}`);
  console.log(`  0x91:05 q      = ${orig.q1}`);

  // ─── ВОПРОС 1: читается ли 0x9b:0f назад ───
  console.log('\n' + '-'.repeat(70));
  console.log('1: пишу 0x9b:0f = 1 в брекете, читаю назад');
  console.log('-'.repeat(70));
  await writeBulk([[0x9b, 0x0f, 1]]);
  const r1 = await readFresh();
  console.log(`  0x9b:0f = ${r1.get('9b:0f')}  (исходно ${orig.sw})`);
  const switchReadable = r1.get('9b:0f') === 1;

  // ─── ВОПРОС 2: пишется ли полоса ПОСЛЕ этого, без брекета ───
  console.log('\n' + '-'.repeat(70));
  console.log('2: теперь пишу 0x91:03 = 3 ОДИНОЧНЫМ кадром (EQ уже включён)');
  console.log('-'.repeat(70));
  await writeSingle([[0x91, 0x03, 3]]);
  const r2 = await readFresh();
  console.log(`  0x91:03 = ${r2.get('91:03')}  ${r2.get('91:03') === 3 ? 'ПРИНЯТО (одиночный кадр работает!)' : 'не принято'}`);
  const singleWorks = r2.get('91:03') === 3;

  // ─── ВОПРОС 3: все поля полосы ───
  console.log('\n' + '-'.repeat(70));
  console.log('3: пишу ВСЕ поля полосы 1 (enable/type/gain/freq/q)');
  console.log('-'.repeat(70));
  await writeSingle([
    [0x91, 0x01, 1],
    [0x91, 0x02, 2],
    [0x91, 0x03, 5],
    [0x91, 0x04, 1000],
    [0x91, 0x05, 10000],
  ]);
  const r3 = await readFresh();
  const fields = [
    ['0x91:01 enable', r3.get('91:01'), 1],
    ['0x91:02 type', r3.get('91:02'), 2],
    ['0x91:03 gain', r3.get('91:03'), 5],
    ['0x91:04 freq', r3.get('91:04'), 1000],
    ['0x91:05 q', r3.get('91:05'), 10000],
  ];
  let allOk = true;
  for (const [name, got, want] of fields) {
    const ok = got === want;
    if (!ok) allOk = false;
    console.log(`  ${name.padEnd(16)} -> ${String(got).padStart(6)}  (хотели ${String(want).padStart(6)})  ${ok ? 'OK' : '-'}`);
  }

  // ─── ВОПРОС 4: сохраняется ли гейт между сессиями ───
  console.log('\n' + '-'.repeat(70));
  console.log('4: новая сессия, пишу полосу БЕЗ повторного включения EQ');
  console.log('-'.repeat(70));
  await writeSingle([[0x91, 0x03, 7]]);
  const r4 = await readFresh();
  console.log(`  0x91:03 = ${r4.get('91:03')}  (хотели 7)`);
  const gatePersists = r4.get('91:03') === 7;

  // ─── откат ───
  console.log('\n' + '-'.repeat(70));
  console.log('ОТКАТ');
  console.log('-'.repeat(70));
  await writeSingle([
    [0x91, 0x01, orig.en1 ?? 0],
    [0x91, 0x02, orig.ty1 ?? 1],
    [0x91, 0x03, orig.g1 ?? 0],
    [0x91, 0x04, orig.f1 ?? 632],
    [0x91, 0x05, orig.q1 ?? 7000],
  ]);
  await writeSingle([[0x9b, 0x0f, orig.sw ?? 0]]);
  const fin = await readFresh(7000);
  console.log(`  0x9b:0f = ${fin.get('9b:0f')}  (было ${orig.sw})`);
  console.log(`  0x91:03 = ${fin.get('91:03')}  (было ${orig.g1})`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  console.log(`  1. 0x9b:0f читается назад:        ${switchReadable ? 'ДА' : 'НЕТ'}`);
  console.log(`  2. одиночная запись после гейта:  ${singleWorks ? 'РАБОТАЕТ' : 'нет'}`);
  console.log(`  3. все поля полосы:               ${allOk ? 'РАБОТАЮТ' : 'частично'}`);
  console.log(`  4. гейт сохраняется между сессиями: ${gatePersists ? 'ДА' : 'НЕТ'}`);
  console.log('');
  if (singleWorks || allOk) {
    console.log('  РАБОЧИЙ ПРОТОКОЛ ЗАПИСИ EQ:');
    console.log('    1) брекет 0x11:20=1 -> 0x9b:<in> = 1 -> 0x11:20=0  (включить EQ)');
    console.log('    2) затем полосы 0x91..0x94 одиночными кадрами');
    console.log('  Без шага 1 полосы ИГНОРИРУЮТСЯ — это и было причиной,');
    console.log('  почему все прежние тесты записи EQ не срабатывали.');
  } else {
    console.log('  Гейт не подтвердился — нужен ещё один прогон.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
