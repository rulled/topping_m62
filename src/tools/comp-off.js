/**
 * Выключить компрессор и вернуть эталонные значения через HID.
 *
 * ВАЖНО: порядок из PROTOCOL.md — handshake ПЕРВЫМ, затем запись.
 * Раньше я писал после announce, и запись могла теряться.
 *
 * БЕЗОПАСНОСТЬ: выходы проверяются; компрессор сейчас ВКЛЮЧЁН,
 * поэтому выключение — это движение в безопасную сторону.
 *
 * Запуск: node src/tools/comp-off.js
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) { console.error('M62 не найден'); process.exit(1); }

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function drain(ms) {
  const t0 = Date.now();
  const seen = new Map();
  while (Date.now() - t0 < ms) {
    let buf;
    try { buf = h.readTimeout(30); } catch { break; }
    if (!buf || !buf.length) continue;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = b;
    if (!(b[0] === 0x22 && b[1] === 0x33) && b[1] === 0x22) f = b.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    seen.set(`${f[5].toString(16)}:${f[6].toString(16)}`, f.readInt32BE(7));
  }
  return seen;
}

const main = async () => {
  const ka = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 1900);

  console.log('1) handshake');
  send(0x11, 0x01, 1);
  const ans = await drain(900);
  console.log(`   ответ: ${ans.get('11:1')}`);

  console.log('2) subscribe + announce (получить состояние)');
  send(0x11, 0x24, 1);
  await sleep(300);
  send(0x11, 0x26, 1);
  const st = await drain(6000);
  console.log(`   Switch(0x46:1) = ${st.get('46:1')}`);
  console.log(`   Attack(0x46:4) = ${st.get('46:4')}`);

  console.log('\n3) пишем эталон (Switch=0 первым)');
  const vals = [
    [0x01, 0],      // Switch OFF
    [0x04, 5],      // Attack
    [0x08, 100],    // Mix
    [0x02, -28],    // Threshold
    [0x05, 200],    // Release
    [0x06, 10],     // Gain
    [0x03, 40],     // Ratio
  ];
  for (const [p, v] of vals) {
    send(0x46, p, v);
    console.log(`   0x46:0x${p.toString(16).padStart(2, '0')} = ${v}`);
    await sleep(250);
  }

  console.log('\n4) save-to-device 11/05 = 1');
  send(0x11, 0x05, 1);
  await sleep(1000);

  console.log('5) проверка: announce');
  send(0x11, 0x26, 1);
  const chk = await drain(7000);
  const sw = chk.get('46:1');
  const atk = chk.get('46:4');
  const mix = chk.get('46:8');
  console.log(`   Switch = ${sw}  (нужно 0)`);
  console.log(`   Attack = ${atk}  (нужно 5)`);
  console.log(`   Mix    = ${mix}  (нужно 100)`);

  clearInterval(ka);
  h.close();
  const ok = sw === 0;
  console.log(`\n=> компрессор ${ok ? 'ВЫКЛЮЧЕН' : 'всё ещё включён'}`);
};

main().catch((e) => { console.error('ошибка:', e.message); process.exit(1); });
