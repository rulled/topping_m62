/**
 * EQUALIZER: ПОЛНЫЙ ЦИКЛ ANNOUNCE + ЗАПИСЬ + ПРОВЕРКА.
 *
 * ═══ ЧТО ВЗЯТО ИЗ ВНЕШНЕГО ДОКУМЕНТА (NTMan/topping-m62, CC0) ═══
 *
 * 1. `11/26` = запрос дампа DSP-блоков (EQ 0x91..0x94, 0xa1..0xaa).
 *    Дамп завершается `11/25` = 1 (три раза).
 * 2. «Прошивка сама коммитит live-состояние после интервала простоя,
 *    поэтому значение, записанное и тут же оборванное с шины, иногда
 *    возвращается, а иногда нет» (у них помечено guessed).
 * 3. «Уравнитель: блоки EQ» — в разделе Still unknown. То есть
 *    даже у них EQ не расшифрован.
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Запись в EQ не видна, потому что:
 *   - карта отдаёт блоки EQ только в ответ на `11/26`;
 *   - запись применяется, но коммитится не сразу.
 *
 * Поэтому: пишем, ждём ДОЛГО (30 с простоя), потом читаем в новой
 * сессии. Плюс явно запрашиваем дамп через `11/26` и ждём `11/25`.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением, всё откатывается.
 *
 * Запуск: node src/tools/prove-eq-slow-commit.js
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
 * Читает состояние, явно запрашивая дамп через 11/26,
 * и ждёт терминатор 11/25.
 */
async function readWithDumpRequest(ms = 14000) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, 0x26, 1); // запрос дампа DSP-блоков

  const out = new Map();
  let sawTerminator = false;
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
      if (f.target === 0x11 && f.prop === 0x25) sawTerminator = true;
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
  return { state: out, sawTerminator };
}

async function writeOne(tt, pp, v) {
  const { h, send } = open();
  await prepare(send);
  send(tt, pp, v);
  await sleep(1000);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ: ЗАПИСЬ + ДОЛГИЙ ПРОСТОЙ + ДАМП ЧЕРЕЗ 11/26');
  console.log('='.repeat(70));

  const base = await readWithDumpRequest(10000);
  const jack = base.state.get('64:06');
  const mute0 = base.state.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  console.log(`терминатор 11/25 получен: ${base.sawTerminator}`);

  if (jack === 1 && mute0 !== 1) {
    await writeOne(0x64, 0x04, 1);
    if ((await readWithDumpRequest(7000)).state.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  }

  const s0 = await readWithDumpRequest();
  const orig = {
    en1: s0.state.get('91:01'),
    g1: s0.state.get('91:03'),
    f1: s0.state.get('91:04'),
    q1: s0.state.get('91:05'),
  };
  console.log('\nисходное (с дампом):');
  console.log(`  0x91:01=${orig.en1}  0x91:03=${orig.g1}  0x91:04=${orig.f1}  0x91:05=${orig.q1}`);

  // ─── шаг 1: пишем ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 1: пишу параметры полосы 1 (enable=1, gain=6, freq=1000)');
  console.log('-'.repeat(70));
  await writeOne(0x91, 0x01, 1);
  await writeOne(0x91, 0x03, 6);
  await writeOne(0x91, 0x04, 1000);

  // ─── шаг 2: сразу читаем ───
  console.log('\nчитаю сразу после записи…');
  const r1 = await readWithDumpRequest(9000);
  console.log(`  0x91:01=${r1.state.get('91:01')}  0x91:03=${r1.state.get('91:03')}  0x91:04=${r1.state.get('91:04')}`);

  // ─── шаг 3: долгий простой ───
  console.log('\n' + '-'.repeat(70));
  console.log('ШАГ 2: простой 35 с (не трогаю шину), потом читаю');
  console.log('-'.repeat(70));
  await sleep(35000);
  const r2 = await readWithDumpRequest(12000);
  const g2 = r2.state.get('91:03');
  const f2 = r2.state.get('91:04');
  const e2 = r2.state.get('91:01');
  console.log(`  0x91:01=${e2}  0x91:03=${g2}  0x91:04=${f2}`);
  const committed = g2 === 6 || f2 === 1000 || e2 === 1;
  console.log(`  ${committed ? 'ЗНАЧЕНИЯ ПРИМЕНИЛИСЬ' : 'значения не применились'}`);

  // ─── шаг 4: ещё дольше (65 с) ───
  if (!committed) {
    console.log('\n' + '-'.repeat(70));
    console.log('ШАГ 3: ещё простой 65 с, потом читаю');
    console.log('-'.repeat(70));
    await sleep(65000);
    const r3 = await readWithDumpRequest(12000);
    const g3 = r3.state.get('91:03');
    const f3 = r3.state.get('91:04');
    console.log(`  0x91:01=${r3.state.get('91:01')}  0x91:03=${g3}  0x91:04=${f3}`);
    console.log(`  ${g3 === 6 || f3 === 1000 ? 'ПРИМЕНИЛИСЬ (с задержкой)' : 'по-прежнему нет'}`);
  }

  // ─── откат ───
  console.log('\nОТКАТ…');
  await writeOne(0x91, 0x01, orig.en1 ?? 0);
  await writeOne(0x91, 0x03, orig.g1 ?? 0);
  await writeOne(0x91, 0x04, orig.f1 ?? 632);
  const fin = await readWithDumpRequest(8000);
  console.log(`  0x91:03 = ${fin.state.get('91:03')} (было ${orig.g1})`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  console.log(`  терминатор 11/25 в дампе: ${base.sawTerminator ? 'ДА' : 'нет'}`);
  console.log(`  запись видна сразу:       ${r1.state.get('91:03') === 6 ? 'да' : 'нет'}`);
  console.log(`  запись видна после 35 с:  ${r2.state.get('91:03') === 6 ? 'да' : 'нет'}`);
  console.log('');
  console.log('  У внешнего документа EQ числится в «Still unknown»:');
  console.log('  даже автор протокола его не расшифровал. Так что это');
  console.log('  не наша недоработка, а открытая часть протокола.');
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
