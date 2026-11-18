/**
 * EQ ПРИХОДИТ ТОЛЬКО НА ПЕРВЫЙ ANNOUNCE СЕССИИ?
 *
 * ═══ ЧТО ОБНАРУЖЕНО ═══
 *
 * Два инструмента дают РАЗНОЕ на одном и том же устройстве:
 *
 *   diagnose-snapshot-decay.js: 9 отдельных сессий -> все 102 тега, EQ=40
 *   control-eq-arrival.js:      2 снимка в ОДНОЙ сессии ->
 *                               1-й 102/40, 2-й 49/0
 *
 * Разница только в одном: во втором случае HID открыт один раз,
 * а announce шлётся повторно внутри той же сессии.
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Устройство отдаёт блоки 0x91..0x94 (EQ входов) только на ПЕРВЫЙ
 * announce после открытия сессии. Повторные announce в той же сессии
 * EQ не возвращают.
 *
 * Если так — это меняет правила измерения:
 *   - нельзя делать «снимок до» и «снимок после» в одной сессии;
 *   - после записи нужна НОВАЯ сессия, и она будет первой;
 *   - предыдущие замеры, где два снимка шли в одной сессии, неверны.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Одна сессия, и в ней:
 *   announce #1 -> слушаем -> считаем
 *   announce #2 -> слушаем -> считаем
 *   announce #3 -> слушаем -> считаем
 *
 * Потом вторая сессия, announce #1 -> слушаем -> считаем
 * (контроль: должна снова дать EQ).
 *
 * Запуск: node src/tools/eq-announce-once.js
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

/** Слушает ms на уже открытом дескрипторе, шлёт announce в начале. */
async function listenAfterAnnounce(h, send, label, ms = 15000) {
  const out = new Map();
  send(0x11, PP_ANNOUNCE, 1);
  const t0 = Date.now();
  let lk = Date.now();
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
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  const eq = [...out.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  console.log(`  ${label.padEnd(22)} тегов=${String(out.size).padStart(3)}  EQ=${String(eq).padStart(2)}`);
  return { total: out.size, eq, map: out };
}

async function main() {
  console.log('='.repeat(60));
  console.log('ОДНА СЕССИЯ, ТРИ ANNOUNCE ПОДРЯД');
  console.log('='.repeat(60));

  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(500);

  const a1 = await listenAfterAnnounce(h, send, 'announce #1 (в сессии)');
  const a2 = await listenAfterAnnounce(h, send, 'announce #2 (та же)');
  const a3 = await listenAfterAnnounce(h, send, 'announce #3 (та же)');

  try {
    h.close();
  } catch { /* ok */ }

  console.log('');
  console.log('='.repeat(60));
  console.log('НОВАЯ СЕССИЯ, ANNOUNCE #1');
  console.log('='.repeat(60));
  await sleep(2000);

  const dev2 = findDev();
  const h2 = new HID.HID(dev2.path);
  const send2 = (tt, pp, v) => h2.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send2(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send2(0x11, PP_SUBSCRIBE, 1);
  await sleep(500);
  const b1 = await listenAfterAnnounce(h2, send2, 'новая сессия #1');
  try {
    h2.close();
  } catch { /* ok */ }

  console.log('');
  console.log('='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  console.log(`  в сессии:   #1 EQ=${a1.eq}   #2 EQ=${a2.eq}   #3 EQ=${a3.eq}`);
  console.log(`  новая сессия: #1 EQ=${b1.eq}`);
  console.log('');

  if (a1.eq > 0 && a2.eq === 0 && b1.eq > 0) {
    console.log('  ПОДТВЕРЖДЕНО: EQ приходит ТОЛЬКО на первый announce сесссии.');
    console.log('  Значит «снимок до / снимок после» в одной сессии НЕ РАБОТАЕТ:');
    console.log('  второй снимок всегда будет пуст, и это не отказ устройства.');
    console.log('  Правило: после записи нужна НОВАЯ сессия.');
  } else if (a1.eq > 0 && a2.eq > 0) {
    console.log('  ОПРОВЕРГНУТО: EQ приходит и на повторный announce.');
    console.log('  Значит пустой второй снимок в control-eq-arrival.js — другой баг.');
  } else {
    console.log('  Неожиданный результат, разбирать отдельно.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
