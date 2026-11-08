/**
 * Проверка: пишутся ли параметры реверба через HID (0x44:0x08..0x0f).
 *
 * ЗАЧЕМ: если да — реверб работает в чистом вебе (WebHID), без MCC и
 * без файлов. Если нет — только файлом, а файлы браузеру недоступны.
 *
 * БЕЗОПАСНОСТЬ: реверб сейчас в Bypass (ReverbType=Bypass), поэтому
 * изменение параметров *Bypass не влияет на звук. Пишем только те
 * параметры, что относятся к Bypass, и возвращаем исходное.
 *
 * Запуск: node src/tools/probe-reverb-hid.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

const TAGS = {
  0x08: 'dryWet',
  0x09: 'level',
  0x0a: 'decay',
  0x0b: 'type',
  0x0f: 'width',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Собирает последние значения тегов 0x44:0x08..0x0f за ms. */
async function readReverb(ms = 4000) {
  const out = new Map();
  const t0 = Date.now();
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
    if (f[5] === 0x44 && TAGS[f[6]] !== undefined) out.set(f[6], f.readInt32BE(7));
  }
  return out;
}

const show = (label, m) => {
  const parts = Object.keys(TAGS)
    .sort()
    .map((p) => `${TAGS[p]}=${m.has(Number(p)) ? m.get(Number(p)) : '—'}`);
  console.log(`  ${label.padEnd(22)} ${parts.join('  ')}`);
};

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const before = await readReverb(5000);
  show('до:', before);
  if (before.size === 0) {
    console.log('  реверб-теги не пришли — стоп');
    clearInterval(keepalive);
    h.close();
    return;
  }

  if (!DO_WRITE) {
    console.log('\n  (режим чтения; добавь --write чтобы проверить запись)');
    clearInterval(keepalive);
    h.close();
    return;
  }

  // Пишем dryWet (0x08): 0 -> 7. Безопасно: тип Bypass, на звук не влияет.
  const prop = 0x08;
  const orig = before.get(prop) ?? 0;
  const target = orig === 7 ? 3 : 7;
  console.log(`\n  пишу dryWet (0x44:0x08) ${orig} -> ${target} ...`);
  send(0x44, prop, target);
  await sleep(900);

  send(0x11, 0x26, 1);
  const after = await readReverb(5000);
  show('после записи:', after);

  const accepted = after.get(prop) === target;
  console.log(`\n  HID принял запись: ${accepted ? 'ДА' : 'НЕТ'}`);

  console.log(`  возвращаю ${orig} ...`);
  send(0x44, prop, orig);
  await sleep(900);
  send(0x11, 0x26, 1);
  const restored = await readReverb(4000);
  show('после отката:', restored);
  console.log(`  откат: ${restored.get(prop) === orig ? 'ОК' : 'НЕ ОК'}`);

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
