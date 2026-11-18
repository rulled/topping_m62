/**
 * Проверка: пишутся ли параметры компрессора через HID (0x46:0x01..0x08).
 *
 * ЗАЧЕМ: определяет, что из компрессора доступно в чистом вебе (WebHID).
 *
 * БЕЗОПАСНОСТЬ: компрессор ВЫКЛЮЧЕН (Compressor.Switch=0), поэтому
 * правка его параметров на звук не влияет. Скрипт отказывается
 * работать, если компрессор включён. В конце возвращает исходное.
 *
 * Запуск: node src/tools/probe-comp-hid.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

const TAGS = {
  0x01: 'Switch',
  0x02: 'Threshold',
  0x03: 'Ratio',
  0x04: 'Attack',
  0x05: 'Release',
  0x06: 'Gain',
  0x07: 'GainAuto',
  0x08: 'Mix',
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

async function readComp(ms = 4000) {
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
    if (f[5] === 0x46 && TAGS[f[6]] !== undefined) out.set(f[6], f.readInt32BE(7));
  }
  return out;
}

const show = (label, m) => {
  const parts = Object.keys(TAGS)
    .sort()
    .map((p) => `${TAGS[p]}=${m.has(Number(p)) ? m.get(Number(p)) : '—'}`);
  console.log(`  ${label.padEnd(20)} ${parts.join('  ')}`);
};

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const before = await readComp(5000);
  show('до:', before);
  if (before.size === 0) {
    console.log('  теги компрессора не пришли — стоп');
    clearInterval(keepalive);
    h.close();
    return;
  }

  if (before.get(0x01) === 1) {
    console.log('\n  СТОП: компрессор ВКЛЮЧЁН. Правка параметров повлияет на звук.');
    console.log('  Выключи компрессор в MCC и повтори.');
    clearInterval(keepalive);
    h.close();
    return;
  }
  console.log('\n  компрессор выключен — правка безопасна');

  if (!DO_WRITE) {
    console.log('  (режим чтения; добавь --write для проверки записи)');
    clearInterval(keepalive);
    h.close();
    return;
  }

  // Attack (0x04): нелинейная шкала не важна, проверяем сам факт записи.
  const prop = 0x04;
  const orig = before.get(prop) ?? 5;
  const target = orig === 6 ? 8 : 6;
  console.log(`\n  пишу Attack (0x46:0x04) ${orig} -> ${target} ...`);
  send(0x46, prop, target);
  await sleep(900);

  send(0x11, 0x26, 1);
  const after = await readComp(5000);
  show('после записи:', after);
  const accepted = after.get(prop) === target;
  console.log(`\n  HID принял запись Attack: ${accepted ? 'ДА' : 'НЕТ'}`);

  console.log(`  возвращаю ${orig} ...`);
  send(0x46, prop, orig);
  await sleep(900);
  send(0x11, 0x26, 1);
  const restored = await readComp(4000);
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
