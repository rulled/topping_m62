/**
 * Проверка: сохраняет ли устройство 0x64:0x04 / 0x62:0x04 после записи.
 *
 * Логика: пишем значение, затем просим ANNOUNCE и смотрим, что
 * устройство САМО сообщает об этом теге. Если оно вернуло записанное —
 * тег для записи годится. Если вернуло прежнее — запись игнорируется.
 *
 * Безопасность: пишем только 0 или 1, и в конце возвращаем исходное.
 * Оба значения не могут сделать звук громче.
 *
 * Запуск: node src/tools/probe-mute-rw.js [hp|otg] [значение]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const WHICH = (process.argv[2] ?? 'hp').toLowerCase();
const TRY = Number(process.argv[3] ?? 1);
const VID = 0x152a;
const PID = 0x875c;
const TARGET = WHICH === 'hp' ? 0x64 : 0x62;
const PROP = 0x04;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Собирает все значения тега за ms. */
async function collect(tt, pp, ms) {
  const t0 = Date.now();
  const values = [];
  while (Date.now() - t0 < ms) {
    let buf;
    try {
      buf = h.readTimeout(30);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) f = bytes.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    if (f[5] === tt && f[6] === pp) values.push(f.readInt32BE(7));
  }
  return values;
}

async function announce() {
  write(0x11, 0x24, 1);
  await sleep(250);
  write(0x11, 0x26, 1);
}

const main = async () => {
  const keepalive = setInterval(() => { try { write(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);
  const tag = `${TARGET.toString(16)}:${PROP.toString(16).padStart(2, '0')}`;
  console.log(`=== ${tag} (${WHICH}) ===`);

  await announce();
  const before = await collect(TARGET, PROP, 9000);
  console.log(`до записи, устройство сообщает: [${before.join(', ')}]`);
  if (before.length === 0) {
    console.log('тег вообще не приходит — тест бессмыслен');
    clearInterval(keepalive);
    h.close();
    return;
  }
  const original = before[before.length - 1];

  console.log(`пишу ${TRY} ...`);
  write(TARGET, PROP, TRY);
  await sleep(1200);

  await announce();
  const after = await collect(TARGET, PROP, 9000);
  console.log(`после записи ${TRY}, устройство сообщает: [${after.join(', ')}]`);

  const accepted = after.length > 0 && after[after.length - 1] === TRY;

  console.log(`возвращаю ${original} ...`);
  write(TARGET, PROP, original);
  await sleep(1200);
  await announce();
  const restored = await collect(TARGET, PROP, 9000);
  console.log(`после отката, устройство сообщает: [${restored.join(', ')}]`);

  console.log('\n=== ИТОГ ===');
  console.log(`запись ${TRY} принята устройством: ${accepted ? 'ДА' : 'НЕТ'}`);
  console.log(`исходное ${original} восстановлено: ${restored[restored.length - 1] === original ? 'ДА' : 'НЕТ'}`);

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
