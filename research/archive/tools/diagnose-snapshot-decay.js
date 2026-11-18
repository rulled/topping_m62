/**
 * ПОЧЕМУ ВТОРОЙ СНИМОК ПОДРЯД ПУСТОЙ?
 *
 * ═══ ЧТО ОБНАРУЖЕНО ═══
 *
 * control-eq-arrival.js при убитом MCC дал:
 *
 *   снимок 1: 102 тега, 40 EQ-тегов, первый EQ на 2.8 с
 *   снимок 2:  49 тегов,  0 EQ-тегов
 *
 * Записи не было вообще. Значит дело не в записи и не в MCC.
 * Гипотеза «MCC держит поток» ОПРОВЕРГНУТА.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 * A. Устройству нужна пауза между сессиями: после закрытия HID
 *    оно какое-то время не отдаёт полный дамп.
 * B. Устройство отдаёт EQ только в ПЕРВОЙ сессии после себя
 *    (то есть после перезагрузки/сброса), а дальше молчит.
 * C. Виноват способ закрытия: h.close() без корректного прощания
 *    оставляет устройство в состоянии «сессия ещё жива».
 * D. Дело в handshake: он нужен только раз, а повторный сбивает.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Проверяет A и C: несколько сессий с РАЗНОЙ паузой между ними,
 * плюс вариант, где перед закрытием отправляется «прощание»
 * (отписка 0x11:0x24 = 0).
 *
 * Запуск: node src/tools/diagnose-snapshot-decay.js
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

/**
 * Одна сессия.
 * @param {number} ms       сколько слушать
 * @param {boolean} farewell отправлять ли отписку перед закрытием
 */
async function session(ms, farewell = false) {
  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = 0;
  let la = 0;
  let eqAt = null;

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
      if (eqAt === null && f.target >= 0x91 && f.target <= 0x94) {
        eqAt = ((Date.now() - t0) / 1000).toFixed(1);
      }
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

  if (farewell) {
    try {
      send(0x11, PP_SUBSCRIBE, 0); // отписка
      await sleep(200);
    } catch { /* ok */ }
  }

  try {
    h.close();
  } catch { /* ok */ }

  const eq = [...out.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  return { total: out.size, eq, eqAt, map: out };
}

async function main() {
  console.log('='.repeat(64));
  console.log('ОПЫТ 1: три сессии подряд, пауза 3 с, без прощания');
  console.log('='.repeat(64));
  for (let i = 1; i <= 3; i++) {
    const r = await session(12000);
    console.log(`  сессия ${i}: тегов=${String(r.total).padStart(3)}`
      + `  EQ=${String(r.eq).padStart(2)}  первый EQ на ${r.eqAt ?? '—'} с`);
    await sleep(3000);
  }

  console.log('');
  console.log('='.repeat(64));
  console.log('ОПЫТ 2: три сессии с прощанием (отписка перед закрытием)');
  console.log('='.repeat(64));
  for (let i = 1; i <= 3; i++) {
    const r = await session(12000, true);
    console.log(`  сессия ${i}: тегов=${String(r.total).padStart(3)}`
      + `  EQ=${String(r.eq).padStart(2)}  первый EQ на ${r.eqAt ?? '—'} с`);
    await sleep(3000);
  }

  console.log('');
  console.log('='.repeat(64));
  console.log('ОПЫТ 3: длинная пауза (20 с) между двумя сессиями');
  console.log('='.repeat(64));
  const a = await session(12000, true);
  console.log(`  сессия 1: тегов=${a.total} EQ=${a.eq}`);
  console.log('  пауза 20 с…');
  await sleep(20000);
  const b = await session(12000, true);
  console.log(`  сессия 2: тегов=${b.total} EQ=${b.eq}`);

  console.log('');
  console.log('='.repeat(64));
  console.log('РАЗБОР');
  console.log('='.repeat(64));
  console.log(`
  Если ОПЫТ 1 даёт «102/40, 49/0, 49/0» — устройство отдаёт полный
  дамп только в первой сессии, дальше молчит до какого-то события.
  Значит для проверки записи НЕЛЬЗЯ открывать вторую сессию:
  надо держать одну и слушать дольше.

  Если ОПЫТ 2 стабильно даёт 102/40 — виновато закрытие без прощания.

  Если ОПЫТ 3 даёт 102/40 — дело в паузе.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
