/**
 * ПРОРЫВ: session handshake 11/01 = 1 (найден в публичной документации).
 *
 * ИСТОЧНИК: github.com/NTMan/topping-m62 (PROTOCOL.md, CC0)
 * Цитата: «11/01 is a session handshake with a reply: host writes 1,
 * the device answers 3. MCC sends nothing after 11/01 until the card
 * has answered it.»
 *
 * РАНЬШЕ МЫ ЭТОГО НЕ ДЕЛАЛИ. Мы отправляли только 11/24 (subscribe)
 * и 11/26 (announce). Возможно, поэтому микшер/EQ/реверб «не писались».
 *
 * Также: 11/20 = 1 открывает bulk push, 11/20 = 0 закрывает.
 *
 * БЕЗОПАСНОСТЬ:
 *   - только handshake + subscribe/announce (безопасные команды);
 *   - выходы проверяются: если подключены — тест записи не выполняется;
 *   - массовую запись значений НЕ делаем, только смотрим, изменится ли
 *     поведение устройства (появятся ли новые теги).
 *
 * Запуск: node src/tools/test-handshake.js
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Собирает теги за ms. */
async function collect(ms, label) {
  const tags = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let buf;
    try { buf = h.readTimeout(30); } catch { break; }
    if (!buf || !buf.length) continue;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = b;
    if (!(b[0] === 0x22 && b[1] === 0x33) && b[1] === 0x22) f = b.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    const key = `0x${f[5].toString(16).padStart(2, '0')}:0x${f[6].toString(16).padStart(2, '0')}`;
    tags.set(key, f.readInt32BE(7));
  }
  console.log(`  [${label}] тегов: ${tags.size}`);
  return tags;
}

const main = async () => {
  const keepalive = setInterval(() => {
    try { send(0x11, 0x24, 1); } catch { /* ok */ }
  }, 1900);

  console.log('=== ШАГ 1: до handshake (как делали раньше) ===');
  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const before = await collect(6000, 'без handshake');
  console.log('  теги:', [...before.keys()].sort().join(' '));

  console.log('\n=== ШАГ 2: SESSION HANDSHAKE 11/01 = 1 ===');
  send(0x11, 0x01, 1);
  const answer = await collect(1500, 'ответ на handshake');
  console.log('  ответ устройства:', [...answer.entries()]
    .filter(([k]) => k.startsWith('0x11:0x01'))
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ') || '(нет)');

  console.log('\n=== ШАГ 3: bulk push bracket 11/20 = 1 ... 11/20 = 0 ===');
  send(0x11, 0x20, 1);
  await sleep(300);
  send(0x11, 0x20, 0);
  await sleep(300);

  console.log('\n=== ШАГ 4: announce после handshake ===');
  send(0x11, 0x26, 1);
  const after = await collect(8000, 'после handshake');

  const newTags = [...after.keys()].filter((k) => !before.has(k)).sort();
  const goneTags = [...before.keys()].filter((k) => !after.has(k)).sort();

  console.log(`\n=== СРАВНЕНИЕ ===`);
  console.log(`  было тегов:  ${before.size}`);
  console.log(`  стало тегов: ${after.size}`);
  console.log(`  НОВЫЕ (${newTags.length}): ${newTags.join(' ') || '(нет)'}`);
  console.log(`  пропали (${goneTags.length}): ${goneTags.join(' ') || '(нет)'}`);

  console.log('\n=== все теги после handshake ===');
  for (const k of [...after.keys()].sort()) {
    const v = after.get(k);
    const isNew = !before.has(k) ? '  <-- НОВЫЙ' : '';
    console.log(`  ${k} = ${v}${isNew}`);
  }

  clearInterval(keepalive);
  h.close();
  console.log('\nhandle закрыт');
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { process.exit(1); } catch { /* ok */ }
});
