/**
 * КОГДА УСТРОЙСТВО ОТДАЁТ ПОЛНЫЙ ДАМП ПОВТОРНО.
 *
 * ═══ НАБЛЮДЕНИЕ ═══
 *
 * Первый снимок за сессию отдаёт 102 адреса (включая 40 тегов EQ).
 * Следующий снимок сразу за ним — EQ уже НЕ отдаёт, хотя метры идут.
 * То есть полный дамп привязан к чему-то, что не сбрасывается
 * переоткрытием HID-дескриптора.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Пауза между подключениями: 0, 3, 10, 30 секунд. После каждой — снимок,
 * и смотрим, пришёл ли EQ.
 *
 * Гипотеза A: дамп раз в N секунд со стороны устройства.
 * Гипотеза B: дамп только при первом подключении после включения.
 * Гипотеза C: дамп после того, как устройство «отпустит» MCC-подобную сессию.
 *
 * Запуск: node src/tools/probe-dump-reacquire.js
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
const SNAPSHOT_MS = 7000;
const KEEPALIVE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

async function snapshot(gapMs) {
  if (gapMs > 0) await sleep(gapMs);
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  let eqAt = null;
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
      const key = `${f.target.toString(16).padStart(2, '0')}:${f.prop
        .toString(16)
        .padStart(2, '0')}`;
      out.set(key, f.value);
      if (eqAt === null && f.target === 0x91) eqAt = Date.now() - t0;
    }
    if (Date.now() - lastKeep >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }
  const eq = [...out.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  return { total: out.size, eq, eqAt, tags: out };
}

async function main() {
  // Паузы можно задать аргументами: node ... 300,600,1000
  const gaps = process.argv[2]
    ? process.argv[2].split(',').map((s) => Number(s.trim()))
    : [0, 3000];
  for (const gap of gaps) {
    const r = await snapshot(gap);
    const eqNote = r.eq ? `EQ ${r.eq} тегов, пришёл на ${r.eqAt} мс` : 'EQ НЕТ';
    console.log(`пауза ${String(gap).padStart(5)} мс -> всего ${r.total} адресов, ${eqNote}`);
  }
  console.log('\nвывод: если EQ приходит только при паузе >= N, значит устройство');
  console.log('держит сессию и отдаёт полный дамп не чаще, чем раз в N секунд.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
