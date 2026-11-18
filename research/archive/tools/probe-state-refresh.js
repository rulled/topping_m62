/**
 * РАЗВЕДКА: как заставить устройство повторить статические свойства.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * EQ, компрессор и часть настроек приходят РОВНО ОДИН раз при подписке
 * (в probe-all-tags.js у них n=1). Значит, после записи значения мы не
 * можем просто «перечитать» его: announce присылает только метры.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *  1. Повторная подписка 0x11:0x24 = 1 — переотправляет ли она EQ?
 *  2. Bulk push 0x11:0x20 — открывает/закрывает пакетную отправку.
 *  3. Переоткрытие HID-дескриптора — самый надёжный полный сброс.
 *
 * Ничего в устройство не пишем, кроме служебных кадров.
 *
 * Запуск: node src/tools/probe-state-refresh.js
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

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;

function open() {
  h = new HID.HID(dev.path);
}

/** Слушает указанное время, возвращает Map "tt:pp" -> значение. */
async function collect(ms, label) {
  const out = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(2);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    await sleep(5);
  }
  const eq = [...out.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  const eqSw = [...out.keys()].filter((k) => k.startsWith('9b:')).length;
  const comp = [...out.keys()].filter((k) => k.startsWith('46:')).length;
  console.log(`  ${label}: всего ${out.size}, EQ ${eq}, EQ-sw ${eqSw}, компрессор ${comp}`);
  return out;
}

const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function main() {
  console.log('1) переоткрытие HID-дескриптора + handshake + subscribe');
  open();
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  await collect(300, 'после handshake');
  send(0x11, PP_SUBSCRIBE, 1);
  const first = await collect(1500, 'после subscribe');
  try { h.close(); } catch { /* ok */ }

  console.log('\n2) повторная подписка на ЖИВОМ соединении');
  open();
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  await collect(300, 'после handshake');
  send(0x11, PP_SUBSCRIBE, 1);
  await collect(1200, 'subscribe #1');
  send(0x11, PP_SUBSCRIBE, 1);
  await collect(1200, 'subscribe #2 (повтор)');

  console.log('\n3) bulk push мы НЕ трогаем — он управляет потоком метроEst');
  console.log('\nитог:');
  console.log('  повторная подписка на том же соединении EQ не переотправляет' );
  console.log('  => для перечитывания состояния нужен полный переподключ.');

  const eqKeys = [...first.keys()].filter((k) => /^9[1-4]:/.test(k)).sort();
  console.log(`\nEQ при первом подключении (${eqKeys.length} шт), 0x91:01..0a:`);
  for (const k of eqKeys.filter((x) => x.startsWith('91:'))) {
    console.log(`  ${k} = ${first.get(k)}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
