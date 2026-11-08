/**
 * Проверка: появляются ли параметры компрессора после Load preset
 * и можно ли их ПОСЛЕ ЭТОГО записать через HID.
 *
 * ЗАЧЕМ: определяет, доступен ли компрессор в чистом вебе (WebHID).
 *
 * БЕЗОПАСНОСТЬ: Load preset 1 загружает пресет, который уже активен
 * (не меняет звук существенно). Компрессор выключен — правка его
 * параметров инертна. Скрипт отказывается работать, если компрессор
 * включён.
 *
 * Запуск: node src/tools/probe-comp-after-preset.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

const TAGS = {
  0x01: 'Switch', 0x02: 'Threshold', 0x03: 'Ratio', 0x04: 'Attack',
  0x05: 'Release', 0x06: 'Gain', 0x07: 'GainAuto', 0x08: 'Mix',
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

async function collect(ms = 6000) {
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
    // заодно 0x91 (полосы EQ) — интересно, приходят ли
    if (f[5] === 0x91) out.set(`eq91_${f[6]}`, f.readInt32BE(7));
  }
  return out;
}

const showComp = (label, m) => {
  const parts = Object.keys(TAGS)
    .sort()
    .map((p) => `${TAGS[p]}=${m.has(Number(p)) ? m.get(Number(p)) : '—'}`);
  console.log(`  ${label.padEnd(18)} ${parts.join('  ')}`);
};

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const before = await collect(4000);
  showComp('до preset:', before);
  const compKeys = [...before.keys()].filter((k) => typeof k === 'number');
  console.log(`  0x46-параметров до preset: ${compKeys.length}`);

  console.log('\n  отправляю Load preset 1 (0x11:0x0e) ...');
  send(0x11, 0x0e, 1);
  const after = await collect(9000);
  showComp('после preset:', after);
  const afterKeys = [...after.keys()].filter((k) => typeof k === 'number');
  console.log(`  0x46-параметров после preset: ${afterKeys.length}`);

  const eqKeys = [...after.keys()].filter((k) => String(k).startsWith('eq91_'));
  console.log(`  0x91-полос EQ после preset: ${eqKeys.length}`);
  if (eqKeys.length) {
    console.log(`    ${eqKeys.map((k) => `${String(k).replace('eq91_', '')}=${after.get(k)}`).join(', ')}`);
  }

  if (afterKeys.length === 0) {
    console.log('\n  ВЫВОД: параметры компрессора через HID не приходят вообще.');
    clearInterval(keepalive);
    h.close();
    return;
  }

  if (after.get(0x01) === 1) {
    console.log('\n  ВНИМАНИЕ: компрессор ВКЛЮЧЁН — писать не буду.');
    clearInterval(keepalive);
    h.close();
    return;
  }

  if (!DO_WRITE) {
    console.log('\n  (режим чтения; добавь --write для проверки записи)');
    clearInterval(keepalive);
    h.close();
    return;
  }

  const prop = 0x04;
  const orig = after.get(prop);
  const target = orig === 6 ? 8 : 6;
  console.log(`\n  пишу Attack (0x46:0x04) ${orig} -> ${target} ...`);
  send(0x46, prop, target);
  await sleep(900);

  console.log('  Load preset для повторного объявления ...');
  send(0x11, 0x0e, 1);
  const check = await collect(8000);
  const got = check.get(prop);
  console.log(`  устройство сообщает Attack = ${got}`);
  console.log(`  ЗАПИСЬ ПРИНЯТА: ${got === target ? 'ДА' : 'НЕТ'}`);

  if (orig !== undefined) {
    console.log(`  возвращаю ${orig} ...`);
    send(0x46, prop, orig);
    await sleep(700);
    send(0x11, 0x0e, 1);
    const back = await collect(7000);
    console.log(`  после отката Attack = ${back.get(prop)}`);
  }

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
