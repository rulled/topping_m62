/**
 * ДЕКОДИРОВАНИЕ ПОЛЕЙ EQ — проверка, принимает ли устройство запись.
 *
 * ═══ ВАЖНО ПРО ТАЙМИНГ (измерено probe-dump-timing.js) ═══
 *
 * Статический дамп приходит НЕ сразу. Замеры:
 *   ~570 мс  — метры, компрессор(част.), reverb, входы, выходы, 0x9b
 *   ~2500 мс — инфо-блок 0x12
 *   ~3200 мс — настройки 0x11
 *   ~4470 мс — EQ 0x91..0x94 (все 40 тегов разом)
 *
 * Поэтому снимок состояния = 6 секунд прослушивания. Снимок в 0.9 с
 * (как было в первой версии) EQ не видит вообще.
 *
 * ═══ СТРУКТУРА ═══
 *
 * 4 группы по 10 свойств: 0x91..0x94, в каждой 01..0a.
 * Полоса = 5 полей. Значит 2 полосы на группу, 8 полос всего.
 * Гипотеза (из workspace-INI, там 2 секции × 4 полосы):
 *   0x91 + 0x92 = EQ_IN1 (4 полосы)
 *   0x93 + 0x94 = EQ_IN2 (4 полосы)
 *
 * Поле 4 = частота Гц, поле 5 = Q x 10000. Поля 1..3 неизвестны.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены (0x64:0x06 = 0, 0x62:0x06 = 0) — звук физически
 * невозможен. Значения в допустимых диапазонах, в конце всё возвращается.
 *
 * Запуск: node src/tools/decode-eq-fields.js
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

/** Полное окно дампа. Меньше 6000 мс EQ не увидит. */
const SNAPSHOT_MS = 6200;
const KEEPALIVE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBES = [
  { pos: 1, value: 1, why: 'включение полосы (было 0)' },
  { pos: 2, value: 2, why: 'тип фильтра (было 1)' },
  { pos: 3, value: 5, why: 'усиление +5 дБ (было 0)' },
  { pos: 4, value: 1000, why: 'частота 1000 Гц (было 632)' },
  { pos: 5, value: 10000, why: 'Q 1.0 (было 7000)' },
];

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const open = () => {
  h = new HID.HID(dev.path);
};
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/**
 * Полный снимок состояния.
 *
 * ВАЖНО: между сессиями нужна пауза >= ~500 мс. Если переоткрыть HID
 * и сразу подписаться, устройство считает сессию той же и полный дамп
 * (включая EQ) НЕ отдаёт — приходит только поток метров.
 * Измерено probe-dump-reacquire.js: 0 мс -> EQ нет, 500 мс -> EQ есть.
 *
 * @returns {Promise<Map<string, number>>}
 */
async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(700);
  open();
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
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
    if (Date.now() - lastKeep >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  console.log('снимок 1 (исходное состояние)…');
  const before = await snapshot();
  const eqCount = [...before.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  console.log(`  адресов всего ${before.size}, EQ ${eqCount}`);
  if (eqCount === 0) {
    console.error('EQ не пришёл — снимок слишком короткий или устройство занято');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  console.log('\nисходные значения (группа 0x91):');
  for (let p = 1; p <= 0x0a; p += 1) {
    const k = `91:${hex2(p)}`;
    console.log(`  ${k} = ${before.get(k)}`);
  }

  console.log('\nпроверка записи в 0x91 (полоса 1 = поля 01..05):');
  const results = [];
  for (const probe of PROBES) {
    const key = `91:${hex2(probe.pos)}`;
    const orig = before.get(key);

    // пишем на ЖИВОМ соединении, затем полный снимок с переподключением
    send(0x91, probe.pos, probe.value);
    await sleep(400);

    const after = await snapshot();
    const got = after.get(key);
    const accepted = got === probe.value;
    results.push({ pos: probe.pos, orig, want: probe.value, got, accepted });

    console.log(
      `  ${key}  было ${orig} -> писали ${probe.value} -> стало ${got}   ` +
        `${accepted ? '=> ПРИНЯТО' : '=> не принято'}   (${probe.why})`,
    );
  }

  const acceptedN = results.filter((r) => r.accepted).length;
  console.log(`\nитог: принято ${acceptedN} из ${results.length}`);

  // восстановление
  console.log('\nвосстановление 0x91:01..05…');
  for (const probe of PROBES) {
    const orig = before.get(`91:${hex2(probe.pos)}`);
    if (orig !== undefined) {
      send(0x91, probe.pos, orig);
      await sleep(150);
    }
  }
  const final = await snapshot();
  let ok = 0;
  for (const probe of PROBES) {
    const key = `91:${hex2(probe.pos)}`;
    const want = before.get(key);
    const got = final.get(key);
    if (got === want) ok += 1;
    else console.log(`  ${key}: стало ${got}, ждали ${want}`);
  }
  console.log(`  восстановлено ${ok} из ${PROBES.length}`);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
