/**
 * Подтверждение: что РЕАЛЬНО пишется через HID.
 *
 * Проверяем те контролы, которые бекенд считает рабочими, и
 * смотрим, возвращает ли устройство записанное значение.
 *
 * БЕЗОПАСНОСТЬ: выходы проверяются и, если подключены, скрипт
 * отказывается менять громкости выходов. Громкость микрофона
 * безопасна всегда (влияет только на вход, звук не воспроизводится).
 * Все значения возвращаются обратно.
 *
 * Запуск: node src/tools/verify-hid-writes.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
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

async function collect(ms = 5000) {
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
    out.set(`0x${f[5].toString(16)}:0x${f[6].toString(16).padStart(2, '0')}`, f.readInt32BE(7));
  }
  return out;
}

async function announce() {
  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  return collect(7000);
}

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  const state = await announce();
  const hpJack = state.get('0x64:0x06');
  const otgJack = state.get('0x62:0x06');
  console.log(`джеки: HP=${hpJack} OTG=${otgJack}`);

  // --- 1. Громкость микрофона (безопасно всегда) ---
  const micKey = '0x21:0x04';
  const micOrig = state.get(micKey);
  console.log(`\n=== Mic-1 volume (${micKey}) ===`);
  console.log(`  сейчас: ${micOrig}`);

  if (DO_WRITE && typeof micOrig === 'number') {
    const target = micOrig === 45 ? 46 : 45;
    console.log(`  пишу ${target} ...`);
    send(0x21, 0x04, target);
    await sleep(700);
    const after = await announce();
    const got = after.get(micKey);
    console.log(`  устройство сообщает: ${got} -> ${got === target ? 'ПРИНЯТО' : 'НЕ принято'}`);

    console.log(`  возвращаю ${micOrig} ...`);
    send(0x21, 0x04, micOrig);
    await sleep(600);
    const back = await announce();
    console.log(`  после отката: ${back.get(micKey)}`);
  }

  // --- 2. Настройки: brightness (безопасно, влияет только на подсветку) ---
  const brKey = '0x11:0x04';
  const brOrig = state.get(brKey);
  console.log(`\n=== Brightness (${brKey}) ===`);
  console.log(`  сейчас: ${brOrig}`);

  if (DO_WRITE && typeof brOrig === 'number') {
    const target = brOrig === 0 ? 1 : 0;
    console.log(`  пишу ${target} ...`);
    send(0x11, 0x04, target);
    await sleep(700);
    const after = await announce();
    const got = after.get(brKey);
    console.log(`  устройство сообщает: ${got} -> ${got === target ? 'ПРИНЯТО' : 'НЕ принято'}`);

    console.log(`  возвращаю ${brOrig} ...`);
    send(0x11, 0x04, brOrig);
    await sleep(600);
    const back = await announce();
    console.log(`  после отката: ${back.get(brKey)}`);
  }

  // --- 3. Громкость HP — только если выход не подключён ---
  const hpKey = '0x64:0x03';
  console.log(`\n=== Headphone volume (${hpKey}) ===`);
  if (hpJack !== 0) {
    console.log('  ПРОПУСК: наушники подключены, не рискую.');
  } else {
    const orig = state.get(hpKey);
    console.log(`  сейчас: ${orig ?? 'не приходит (джек не подключён)'}`);
    if (DO_WRITE && typeof orig === 'number') {
      const target = orig === 50 ? 51 : 50;
      console.log(`  пишу ${target} ...`);
      send(0x64, 0x03, target);
      await sleep(700);
      const after = await announce();
      const got = after.get(hpKey);
      console.log(`  устройство сообщает: ${got} -> ${got === target ? 'ПРИНЯТО' : 'НЕ принято'}`);
      send(0x64, 0x03, orig);
      await sleep(600);
    }
  }

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
