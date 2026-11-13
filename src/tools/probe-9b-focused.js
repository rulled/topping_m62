/**
 * 0x9b:0x12 / 0x9b:0x13 — ЧТО ЭТО. ФОКУСИРОВАННЫЙ ТЕСТ.
 *
 * ═══ ЧТО УЖЕ ЗНАЕМ ═══
 *
 *   Перебор значений (probe-9b12-range.js):
 *       0 -> 0 ПРИНЯТО    1 -> 0    2 -> 2 ПРИНЯТО
 *       5, 10, 50, 100, 500 -> 2
 *   То есть enum 0..2, всё больше 2 схлопывается в 2.
 *
 *   Соседи по семейству 0x9b:
 *       0x0b  = метры уровня (-528, -537, ...)   <- НЕ параметр
 *       0x0d / 0x0e = EQ IN1/IN2 gain
 *       0x0f / 0x10 = EQ IN1/IN2 switch
 *       0x12 / 0x13 = ??? (enum 0..2)
 *
 *   ВАЖНО: MCC НИКОГДА не пишет 0x9b (проверено по захватам) —
 *   он только читает. Значит 0x9b приходит как ОТРАЖЕНИЕ состояния.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 *   A. Режим отображения EQ. В MCC есть строки:
 *        EQStateTarget, EQStateSource, EQStateEachFilter,
 *        EQStateCombined, EQStateFiltered
 *      Ровно группа radio-переключателей. Три состояния -> enum 0..2.
 *   B. Тип фильтрации для входа (EQFilteredType).
 *   C. Служебный флаг устройства, не параметр.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Пишет enum при РАЗНЫХ состояниях EQ и смотрит, что читается назад.
 * Если 0x9b:12 меняется сам при включении EQ — это отражение
 * состояния. Если принимает любое 0..2 всегда — это параметр.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники ГЛУШАТСЯ через HID (0x64:04 = 1) и проверяется, что mute
 * применился. Только после этого идут записи. В конце mute снимается
 * в исходное состояние.
 *
 * Запуск: node src/tools/probe-9b-focused.js
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
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

/** Открыть сессию, собрать снимок за `ms`. */
async function snapshot(ms = 6000) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
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

/** Записать несколько кадров в одной сессии. */
async function write(frames) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(350);
  }
  await sleep(800);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(64));
  console.log('0x9b:0x12 / 0x9b:0x13 — ФОКУСИРОВАННЫЙ ТЕСТ');
  console.log('='.repeat(64));

  const base = await snapshot(7000);
  const hpJack = base.get('64:06');
  const hpMute = base.get('64:04');
  console.log(`\nнаушники: jack=${hpJack} mute=${hpMute}`);

  // ─── БЕЗОПАСНОСТЬ: глушим наушники ───
  let wasMuted = hpMute === 1;
  if (hpJack === 1 && !wasMuted) {
    console.log('наушники подключены -> глушу (0x64:04 = 1)');
    await write([[0x64, 0x04, 1]]);
    const chk = await snapshot(5000);
    const m = chk.get('64:04');
    console.log(`  mute после записи: ${m}`);
    if (m !== 1) {
      console.log('  НЕ УДАЛОСЬ заглушить — ОСТАНОВ, тест не запускаю');
      process.exit(1);
    }
    console.log('  подтверждено: выход заглушён');
  } else if (hpJack === 1 && wasMuted) {
    console.log('наушники подключены, но уже заглушены — можно');
  } else {
    console.log('наушники не подключены — безопасно');
  }

  const restoreMute = hpJack === 1 && !wasMuted;

  const base2 = await snapshot(7000);
  const s = (k) => base2.get(k);
  console.log('\nисходное состояние EQ:');
  console.log(`  0x9b:0d EQ IN1 gain   = ${s('9b:0d')}`);
  console.log(`  0x9b:0e EQ IN2 gain   = ${s('9b:0e')}`);
  console.log(`  0x9b:0f EQ IN1 switch = ${s('9b:0f')}`);
  console.log(`  0x9b:10 EQ IN2 switch = ${s('9b:10')}`);
  console.log(`  0x9b:12              = ${s('9b:12')}   <-- цель`);
  console.log(`  0x9b:13              = ${s('9b:13')}   <-- цель`);

  const orig12 = s('9b:12');
  const orig13 = s('9b:13');

  // ─── ТЕСТ 1: меняется ли 0x9b:12 при включении EQ ───
  console.log('\n' + '-'.repeat(64));
  console.log('ТЕСТ 1: включает EQ IN1 (0x9b:0f = 1), смотрю на 0x9b:12');
  console.log('-'.repeat(64));
  await write([[0x9b, 0x0f, 1]]);
  const eqOn = await snapshot(6000);
  console.log(`  0x9b:0f switch = ${eqOn.get('9b:0f')}`);
  console.log(`  0x9b:12        = ${eqOn.get('9b:12')}   (было ${orig12})`);
  console.log(`  0x9b:13        = ${eqOn.get('9b:13')}   (было ${orig13})`);
  const changedByEq = eqOn.get('9b:12') !== orig12 || eqOn.get('9b:13') !== orig13;
  console.log(`  => ${changedByEq ? 'ЗАВИСИТ от состояния EQ' : 'НЕ зависит от EQ'}`);

  // ─── ТЕСТ 2: принимает ли enum при включённом EQ ───
  console.log('\n' + '-'.repeat(64));
  console.log('ТЕСТ 2: при включённом EQ пишу 0x9b:12 = 0,1,2');
  console.log('-'.repeat(64));
  const results = [];
  for (const v of [0, 1, 2]) {
    await write([[0x9b, 0x12, v]]);
    const r = await snapshot(5000);
    const got = r.get('9b:12');
    const ok = got === v;
    console.log(`  пишу ${v} -> читаю ${got}   ${ok ? 'ПРИНЯТО' : 'НЕ принято'}`);
    results.push({ v, got, ok });
  }

  // ─── ТЕСТ 3: то же для IN2 ───
  console.log('\n' + '-'.repeat(64));
  console.log('ТЕСТ 3: включает EQ IN2 (0x9b:10 = 1) и смотрю 0x9b:13');
  console.log('-'.repeat(64));
  await write([[0x9b, 0x10, 1]]);
  const eq2 = await snapshot(5000);
  console.log(`  0x9b:10 = ${eq2.get('9b:10')}`);
  console.log(`  0x9b:13 = ${eq2.get('9b:13')}   (было ${orig13})`);

  // ─── восстановление ───
  console.log('\n' + '-'.repeat(64));
  console.log('ВОССТАНОВЛЕНИЕ');
  console.log('-'.repeat(64));
  await write([
    [0x9b, 0x12, orig12 ?? 0],
    [0x9b, 0x13, orig13 ?? 0],
    [0x9b, 0x0f, s('9b:0f') ?? 0],
    [0x9b, 0x10, s('9b:10') ?? 0],
  ]);
  console.log('  значения 0x9b возвращены');

  if (restoreMute) {
    await write([[0x64, 0x04, 0]]);
    console.log('  mute наушников снят (как было)');
  }

  const fin = await snapshot(4000);
  console.log(`\nфинальное состояние: 0x9b:12=${fin.get('9b:12')} 0x9b:13=${fin.get('9b:13')}`);

  // ─── ВЕРДИКТ ───
  console.log('\n' + '='.repeat(64));
  console.log('ВЕРДИКТ');
  console.log('='.repeat(64));
  const accepted = results.filter((r) => r.ok);
  if (changedByEq) {
    console.log('  0x9b:12/13 МЕНЯЕТСЯ вместе с состоянием EQ');
    console.log('  => это ОТРАЖЕНИЕ режима EQ, а не отдельный параметр.');
    console.log('  Для нашего клиента он не нужен: режим EQ мы задаём сами.');
  } else if (accepted.length === results.length) {
    console.log('  0x9b:12 принимает 0/1/2 при включённом EQ');
    console.log('  => это ПАРАМЕТР (вероятно режим отображения EQ).');
  } else {
    console.log('  поведение смешанное — см. таблицу выше');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
