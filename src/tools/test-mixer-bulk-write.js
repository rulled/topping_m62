/**
 * ЗАПИСЬ МИКШЕРА ЧЕРЕЗ BULK PUSH — главная проверка.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * Микшер не пишется одиночными кадрами. Он передаётся пакетом между:
 *     0x11:0x20 = 1     открыть
 *     ... 242 кадра ...
 *     0x11:0x20 = 0     закрыть
 *
 * Структура (из захвата MCC):
 *     0x31/0x32 = Mix A L/R    0x33/0x34 = Mix B L/R
 *     0x35/0x36 = Mix C L/R    0x37/0x38 = Mix D L/R
 *     0x3b/0x3c = Mix E L/R
 *     свойства 0x01..0x14 = 10 стерео-источников x 2 (нечёт L, чёт R)
 *     значение = Q25
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Можем ли МЫ записать микшер через bulk push, без MCC?
 *
 * Метод:
 *   1. MCC закрыт.
 *   2. Открываем сессию, handshake.
 *   3. Открываем брекет 0x11:0x20 = 1.
 *   4. Шлём ПОЛНУЮ матрицу: все 10 групп x 20 свойств, как делал MCC.
 *      Значения: 0 (mute) везде, кроме одного кросспоинта — его ставим в
 *      -20 дБ, чтобы изменение было заметным и безопасным (тише).
 *   5. Закрываем брекет, шлём 0x11:0x26 = 1.
 *   6. Перечитываем полным дампом.
 *
 * БЕЗОПАСНОСТЬ:
 *   HP и OTG отключены -> звук физически невозможен.
 *   Все значения либо mute (0), либо -20 дБ (тише unity).
 *   Никогда не ставим громче 0 дБ.
 *   В конце восстанавливаем исходную матрицу из захвата MCC.
 *
 * Запуск: node src/tools/test-mixer-bulk-write.js
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

const Q25_UNITY = 33554432;
const dbToQ25 = (db) => Math.round(Math.pow(10, db / 20) * Q25_UNITY);

/** Группы микшера: [L, R] на каждый микс. */
const MIX_GROUPS = [
  { name: 'A', l: 0x31, r: 0x32 },
  { name: 'B', l: 0x33, r: 0x34 },
  { name: 'C', l: 0x35, r: 0x36 },
  { name: 'D', l: 0x37, r: 0x38 },
  { name: 'E', l: 0x3b, r: 0x3c },
];

/** 20 свойств: источник 1L,R .. источник 10L,R. */
const PROPS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Матрица по умолчанию — снята из захвата MCC (default state).
 * Ключ: "TT:PP", значение Q25.
 */
const DEFAULT_MATRIX = {
  // Mix B L (0x33): источники 1,2,3,4 = 0dB; 5,6 = -6dB; 9,10,13,14 = 0dB
  '0x33:0x01': Q25_UNITY, '0x33:0x03': Q25_UNITY, '0x33:0x05': Q25_UNITY,
  '0x33:0x07': Q25_UNITY, '0x33:0x09': 16777216, '0x33:0x0a': 16777216,
  '0x33:0x0b': Q25_UNITY, '0x33:0x0f': Q25_UNITY, '0x33:0x11': Q25_UNITY,
  '0x33:0x13': Q25_UNITY,
  // Mix B R (0x34): зеркально
  '0x34:0x02': Q25_UNITY, '0x34:0x04': Q25_UNITY, '0x34:0x06': Q25_UNITY,
  '0x34:0x08': Q25_UNITY, '0x34:0x09': 16777216, '0x34:0x0a': 16777216,
  '0x34:0x0c': Q25_UNITY, '0x34:0x10': Q25_UNITY, '0x34:0x12': Q25_UNITY,
  '0x34:0x14': Q25_UNITY,
  // Mix C L (0x35)
  '0x35:0x09': 16777216, '0x35:0x0a': 16777216, '0x35:0x0b': Q25_UNITY,
  '0x35:0x0f': Q25_UNITY,
  // Mix C R (0x36)
  '0x36:0x09': 16777216, '0x36:0x0a': 16777216, '0x36:0x0c': Q25_UNITY,
  '0x36:0x10': Q25_UNITY,
};

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshot(ms = 7000) {
  try { h.close(); } catch { /* ok */ }
  await sleep(800);
  h = new HID.HID(dev.path);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
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
      out.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

async function main() {
  console.log('=== 1. снимок до ===');
  let s = await snapshot();
  const hp = s.get('64:06');
  const otg = s.get('62:06');
  console.log(`  адресов ${s.size}, HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  // Проверяем: видно ли микшер в дампе
  const mixInDump = [...s.keys()].filter((k) => /^3[1-8b-c]:0[1-9a-f]/.test(k) && !k.endsWith(':15'));
  console.log(`  микшерных кросспоинтов в дампе: ${mixInDump.length} (ожидаем 0 — они не читаются)`);

  // ---------- 2. пишем пакетом ----------
  console.log('\n=== 2. запись микшера через bulk push ===');

  // Собираем матрицу: дефолт из захвата + один тестовый кросспоинт
  const matrix = { ...DEFAULT_MATRIX };
  const TEST_KEY = '0x33:0x01'; // Mix B L <- источник 1 L
  const TEST_DB = -20;
  matrix[TEST_KEY] = dbToQ25(TEST_DB);
  console.log(`  тестовый кросспоинт ${TEST_KEY}: ${TEST_DB} дБ (Q25 ${matrix[TEST_KEY]})`);
  console.log(`  остальные — по умолчанию из захвата MCC`);

  // Открываем брекет
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(100);
  console.log('  брекет открыт (0x11:0x20 = 1)');

  // Шлём всю матрицу: 10 групп x 20 свойств
  let sent = 0;
  for (const mix of MIX_GROUPS) {
    for (const tt of [mix.l, mix.r]) {
      for (const pp of PROPS) {
        const key = `0x${tt.toString(16)}:0x${pp.toString(16).padStart(2, '0')}`;
        const value = matrix[key] ?? 0;
        send(tt, pp, value);
        sent += 1;
        await sleep(2);
      }
    }
  }
  console.log(`  отправлено ${sent} кадров матрицы`);

  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(200);
  console.log('  брекет закрыт (0x11:0x20 = 0)');

  // Просим дамп обратно
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(2000);
  try { h.close(); } catch { /* ok */ }

  // ---------- 3. проверка ----------
  console.log('\n=== 3. снимок после ===');
  await sleep(2000);
  const after = await snapshot();
  console.log(`  адресов ${after.size}`);

  const mixAfter = [...after.keys()].filter((k) => /^3[1-8b-c]:0[1-9a-f]/.test(k) && !k.endsWith(':15'));
  console.log(`  микшерных кросспоинтов в дампе: ${mixAfter.length}`);

  console.log('\n=== 4. ВЫВОД ===');
  if (mixAfter.length > 0) {
    console.log('  Микшер ЧИТАЕТСЯ обратно! Значит запись применилась.');
    for (const k of mixAfter.slice(0, 20)) console.log(`    ${k} = ${after.get(k)}`);
  } else {
    console.log('  Микшер по-прежнему не читается обратно — это ожидаемо.');
    console.log('  Запись могла примениться, но проверить можно только по звуку');
    console.log('  или по тому, сохранит ли MCC новое значение в INI при старте.');
    console.log('');
    console.log('  СЛЕДУЮЩИЙ ШАГ: запустить MCC, закрыть, прочитать INI.');
    console.log('  Если Mix B L для источника 1 стал -20 -> запись сработала.');
  }

  // ---------- 5. восстановление ----------
  console.log('\n=== 5. восстановление исходной матрицы ===');
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(300);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(100);
  let restored = 0;
  for (const mix of MIX_GROUPS) {
    for (const tt of [mix.l, mix.r]) {
      for (const pp of PROPS) {
        const key = `0x${tt.toString(16)}:0x${pp.toString(16).padStart(2, '0')}`;
        send(tt, pp, DEFAULT_MATRIX[key] ?? 0);
        restored += 1;
        await sleep(2);
      }
    }
  }
  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(200);
  send(0x11, PP_ANNOUNCE, 1);
  console.log(`  восстановлено ${restored} кадров`);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
