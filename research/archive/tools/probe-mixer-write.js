/**
 * ПЕРВАЯ В ИСТОРИИ ПРОЕКТА попытка записи в теги МИКШЕРА (0x41..0x48).
 *
 * Раньше проверяли только ЧТЕНИЕ: двигали слайдеры в MCC и смотрели,
 * придут ли теги. Не приходили — и был сделан вывод «микшер не на HID».
 * Это логическая ошибка: селекторы тоже никогда не приходят, а пишутся.
 *
 * БЕЗОПАСНОСТЬ:
 *   - выходы HP и OTG НЕ подключены (проверяется: 0x64:0x06=0, 0x62:0x06=0)
 *     -> сигнал с шин Mix физически некуда вывести, звук невозможен;
 *   - пишем только отрицательные значения усиления (-90, минимум шкалы),
 *     чтобы даже при случайном попадании не усилить сигнал;
 *   - диапазон строго 0x41..0x48 (шины Mix A..H по данным бинаря);
 *   - скрипт отказывается работать, если выход подключён.
 *
 * ЧТО СЧИТАЕМ УСПЕХОМ:
 *   - устройство приняло запись без ошибки И
 *   - в потоке появился ЛЮБОЙ новый тег, которого раньше не было.
 *
 * Запуск: node src/tools/probe-mixer-write.js
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;

const BUSES = [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48];
const PROPS = [];
for (let p = 0x00; p <= 0x12; p++) PROPS.push(p);

/** Значение: минимальное усиление, безопасно при любом попадании. */
const SAFE_VALUE = -90;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const write = (tt, pp, v) => {
  try {
    return { ok: true, n: h.write([...withReportId(buildFrame(tt, pp, v, true))]) };
  } catch (err) {
    return { ok: false, err: err.message };
  }
};

async function collect(ms) {
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

async function baseline() {
  write(0x11, 0x24, 1);
  await sleep(250);
  write(0x11, 0x26, 1);
  return collect(6000);
}

const main = async () => {
  const keepalive = setInterval(() => { try { write(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  const base = await baseline();
  const hp = base.get('0x64:0x06');
  const otg = base.get('0x62:0x06');
  console.log('=== безопасность ===');
  console.log(`  HP jack=${hp}  OTG jack=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('\n  СТОП: выход подключён — звук возможен, не рискую.');
    clearInterval(keepalive); h.close(); return;
  }
  console.log('  -> выходы не подключены, звук физически невозможен\n');

  console.log(`=== базовых тегов: ${base.size} ===`);
  console.log(`  (среди них тегов микшера 0x41..0x48: ${[...base.keys()].filter((k) => /^0x4[1-8]:/.test(k)).length})\n`);

  const found = [];
  const writeErrors = [];

  for (const bus of BUSES) {
    process.stdout.write(`  шина 0x${bus.toString(16)}: `);
    let busFound = 0;
    for (const pp of PROPS) {
      const r = write(bus, pp, SAFE_VALUE);
      if (!r.ok) writeErrors.push(`0x${bus.toString(16)}:0x${pp.toString(16)} -> ${r.err}`);
      busFound++;
    }
    await sleep(300);
    const after = await collect(3000);
    const newKeys = [...after.keys()].filter((k) => !base.has(k));
    if (newKeys.length) {
      found.push({ bus, newKeys });
      console.log(`НОВЫЕ ТЕГИ: ${newKeys.join(', ')}`);
    } else {
      console.log(`нет реакции (${busFound} записей)`);
    }
  }

  if (writeErrors.length) {
    console.log(`\n=== ошибки записи (${writeErrors.length}) ===`);
    writeErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }

  console.log('\n=== ИТОГ ===');
  if (found.length) {
    console.log('  ЕСТЬ РЕАКЦИЯ — микшер отвечает на HID-запись:');
    found.forEach((f) => console.log(`    шина 0x${f.bus.toString(16)}: ${f.newKeys.join(', ')}`));
  } else {
    console.log('  реакции нет ни на одной шине 0x41..0x48.');
    console.log(`  записей отправлено: ${BUSES.length * PROPS.length}`);
    console.log('  -> либо тег кодируется иначе, либо канал не HID.');
  }

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
