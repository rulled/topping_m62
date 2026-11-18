/**
 * РЕШАЮЩИЙ ТЕСТ: байт операции f[4] в кадре.
 *
 * Формат кадра:  22 33 | 20 01 | OP | TT | PP | value | CRC | 66 77
 *
 * До сих пор мы ВСЕГДА ставили OP = 0x01. Громкости при этом пишутся,
 * а эффекты (компрессор/EQ/реверб) — нет. Возможно, для эффектов
 * нужен другой OP.
 *
 * БЕЗОПАСНОСТЬ:
 *   - цель — Compressor.Attack (0x46:0x04), компрессор ВЫКЛЮЧЕН;
 *   - выходы НЕ подключены (HP=0, OTG=0) -> звук физически невозможен;
 *   - скрипт проверяет оба условия и отказывается работать иначе;
 *   - в конце возвращает исходное значение.
 *
 * Запуск: node src/tools/probe-op-byte.js
 */

import HID from 'node-hid';

import { crc16modbus } from '../crc16.js';

const VID = 0x152a;
const PID = 0x875c;

const TT = 0x46;   // компрессор
const PP = 0x04;   // Attack

/** Кандидаты в байт операции. */
const OPS = [0x01, 0x02, 0x03, 0x00, 0x04, 0x10, 0x20];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Собирает кадр 15 байт с произвольным OP. */
function frame(op, tt, pp, value) {
  const f = new Uint8Array(15);
  f[0] = 0x22; f[1] = 0x33;
  f[2] = 0x20; f[3] = 0x01;
  f[4] = op;
  f[5] = tt;
  f[6] = pp;
  const v = value >>> 0;
  f[7] = (v >>> 24) & 0xff;
  f[8] = (v >>> 16) & 0xff;
  f[9] = (v >>> 8) & 0xff;
  f[10] = v & 0xff;
  const crc = crc16modbus(f.subarray(2, 11));
  f[11] = (crc >>> 8) & 0xff;
  f[12] = crc & 0xff;
  f[13] = 0x66; f[14] = 0x77;
  return f;
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);

const write = (op, tt, pp, v) => h.write([0x00, ...frame(op, tt, pp, v)]);

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
    out.set(`0x${f[5].toString(16)}:0x${f[6].toString(16).padStart(2, '0')}`, f.readInt32BE(7));
  }
  return out;
}

/** ANNOUNCE (джеки, настройки) + Load preset (компрессор, EQ). */
async function fullState() {
  write(0x01, 0x11, 0x24, 1);
  await sleep(250);
  write(0x01, 0x11, 0x26, 1);
  const a = await collect(6000);
  write(0x01, 0x11, 0x0e, 1);
  const b = await collect(9000);
  return new Map([...a, ...b]);
}

const KEY = `0x${TT.toString(16)}:0x${PP.toString(16).padStart(2, '0')}`;

const main = async () => {
  const keepalive = setInterval(() => { try { write(0x01, 0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  const state = await fullState();

  // --- безопасность ---
  const hp = state.get('0x64:0x06');
  const otg = state.get('0x62:0x06');
  const compSw = state.get('0x46:0x01');
  console.log('=== безопасность ===');
  console.log(`  выходы: HP=${hp} OTG=${otg}`);
  console.log(`  Compressor.Switch=${compSw}`);
  if (hp !== 0 || otg !== 0) {
    console.log('\nСТОП: выход подключён — звук возможен.');
    clearInterval(keepalive); h.close(); return;
  }
  if (compSw !== 0) {
    console.log('\nСТОП: компрессор включён.');
    clearInterval(keepalive); h.close(); return;
  }
  console.log('  -> звук невозможен, компрессор инертен\n');

  const orig = state.get(KEY);
  console.log(`=== цель: ${KEY} (Compressor.Attack), сейчас ${orig} ===\n`);

  if (typeof orig !== 'number') {
    console.log('тег не приходит — тест невозможен');
    clearInterval(keepalive); h.close(); return;
  }

  const target = orig === 6 ? 8 : 6;
  const results = [];

  for (const op of OPS) {
    console.log(`OP=0x${op.toString(16).padStart(2, '0')}: пишу ${target} ...`);
    write(op, TT, PP, target);
    await sleep(700);

    const after = await fullState();
    const got = after.get(KEY);
    const accepted = got === target;
    console.log(`   -> устройство сообщает ${got}  ${accepted ? '✅ ПРИНЯТО' : ''}`);
    results.push({ op, got, accepted });

    if (accepted) {
      console.log('   возвращаю исходное ...');
      write(op, TT, PP, orig);
      await sleep(600);
      const back = await fullState();
      console.log(`   после отката: ${back.get(KEY)}`);
      break;
    }
  }

  console.log('\n=== ИТОГ ===');
  for (const r of results) {
    console.log(`  OP=0x${r.op.toString(16).padStart(2, '0')}  ->  ${r.accepted ? 'ПРИНЯТО' : `не принято (${r.got})`}`);
  }
  const win = results.find((r) => r.accepted);
  console.log(win
    ? `\n  РАБОЧИЙ OP = 0x${win.op.toString(16).padStart(2, '0')}`
    : '\n  ни один OP не сработал — дело не в байте операции');

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
