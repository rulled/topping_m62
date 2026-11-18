/**
 * МИКШЕР через HID — по публичной документации NTMan/topping-m62.
 *
 * ИЗ PROTOCOL.md:
 *   «Target = mix and output channel, property = SOURCE channel,
 *    value = linear gain in Q25.»
 *
 *   Mix A 0x31/0x32, Mix B 0x33/0x34, Mix C 0x35/0x36 (left/right)
 *   Source properties: 01/02 Playback 1/2, 03/04 3/4, 05/06 5/6,
 *                      07/08 7/8, 11/12 Playback 9/10
 *                      09/0a, 0b/0c, 0d/0e, 0f/10 — IN/AUX/BT/OTG
 *
 *   Q25: unity = 2^25 = 33554432 = 0 dB, 0 = mute,
 *        +12 dB = 133582600
 *
 * БЕЗОПАСНОСТЬ:
 *   - handshake 11/01 обязателен;
 *   - выходы проверяются: если HP/OTG подключены — СТОП (микшер влияет
 *     на громкость, при подключённых наушниках это риск);
 *   - пишем значения НЕ ГРОМЧЕ текущих (только вниз или равные);
 *   - в конце возвращаем исходное.
 *
 * Запуск: node src/tools/test-mixer-matrix.js
 */

import { readFileSync } from 'node:fs';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live\\M62_Live_main.ini';

const Q25_UNITY = 33554432;
const Q25_MAX = 133582600;   // +12 dB
const Q25_MIN = 0;           // mute

const MIXES = {
  'Mix A': [0x31, 0x32],
  'Mix B': [0x33, 0x34],
  'Mix C': [0x35, 0x36],
};

/** stereo source -> [leftProp, rightProp] */
const SOURCES = {
  'Playback 1/2': [0x01, 0x02],
  'Playback 3/4': [0x03, 0x04],
  'Playback 5/6': [0x05, 0x06],
  'Playback 7/8': [0x07, 0x08],
  'Playback 9/10': [0x11, 0x12],
  'IN': [0x09, 0x0a],
  'AUX': [0x0b, 0x0c],
  'BT': [0x0d, 0x0e],
  'OTG': [0x0f, 0x10],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readMixerIni() {
  const txt = readFileSync(INI, 'utf8');
  const out = {};
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) { cur = t.slice(1, -1); continue; }
    if (!cur || !/^Mixer_/.test(cur) || !t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[`${cur}.${t.slice(0, eq).trim()}`] = t.slice(eq + 1).trim();
  }
  return out;
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) { console.error('M62 не найден'); process.exit(1); }

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function collect(ms) {
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
    tags.set(`0x${f[5].toString(16)}:0x${f[6].toString(16).padStart(2, '0')}`, f.readInt32BE(7));
  }
  return tags;
}

const dbToQ25 = (db) => Math.round(Math.pow(10, db / 20) * Q25_UNITY);
const q25ToDb = (q) => (q <= 0 ? -Infinity : 20 * Math.log10(q / Q25_UNITY));

const main = async () => {
  const ini0 = readMixerIni();
  const nz0 = Object.entries(ini0).filter(([, v]) => v !== '0' && v !== 'false');
  console.log(`=== INI микшер: полей ${Object.keys(ini0).length}, ненулевых ${nz0.length} ===`);
  for (const [k, v] of nz0.slice(0, 10)) console.log(`  ${k} = ${v}`);

  // handshake
  console.log('\n=== handshake + subscribe ===');
  send(0x11, 0x01, 1);
  console.log(`  ответ 11/01 = ${(await collect(1200)).get('0x11:0x01')}`);
  send(0x11, 0x24, 1);
  await sleep(300);
  send(0x11, 0x26, 1);
  const st = await collect(7000);

  // безопасность
  const hp = st.get('0x64:0x06') ?? 0;
  const otg = st.get('0x62:0x06') ?? 0;
  console.log(`\nджеки: HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён. Микшер меняет громкость — не рискую.');
    h.close();
    return;
  }
  console.log('выходы не подключены — безопасно\n');

  const keepalive = setInterval(() => {
    try { send(0x11, 0x24, 1); } catch { /* ok */ }
  }, 1900);

  // --- пишем в Mix A: Playback 1/2 = -20 dB ---
  const targetDb = -20;
  const q = dbToQ25(targetDb);
  const [ttL, ttR] = MIXES['Mix A'];
  const [ppL, ppR] = SOURCES['Playback 1/2'];

  console.log(`=== пишем Mix A / Playback 1/2 = ${targetDb} dB (Q25 = ${q}) ===`);
  console.log(`  target L=0x${ttL.toString(16)} R=0x${ttR.toString(16)}, props ${ppL}/${ppR}`);

  send(ttL, ppL, q);
  await sleep(150);
  send(ttR, ppR, q);
  await sleep(150);

  console.log('\n=== читаем обратно через announce ===');
  send(0x11, 0x26, 1);
  const after = await collect(7000);
  const gotL = after.get(`0x${ttL.toString(16)}:0x${ppL.toString(16).padStart(2, '0')}`);
  const gotR = after.get(`0x${ttR.toString(16)}:0x${ppR.toString(16).padStart(2, '0')}`);
  console.log(`  0x${ttL.toString(16)}:0x${ppL.toString(16).padStart(2, '0')} = ${gotL} (писали ${q})`);
  console.log(`  0x${ttR.toString(16)}:0x${ppR.toString(16).padStart(2, '0')} = ${gotR} (писали ${q})`);

  const mixerTags = [...after.keys()].filter((k) => /^0x3[1-6]:/.test(k)).sort();
  console.log(`\n  тегов микшера 0x31..0x36 в потоке: ${mixerTags.length}`);
  for (const k of mixerTags) {
    const v = after.get(k);
    console.log(`    ${k} = ${v}  (${q25ToDb(v).toFixed(2)} dB)`);
  }

  // --- сохранить в устройство ---
  console.log('\n=== save-to-device 11/05 = 1 ===');
  send(0x11, 0x05, 1);
  await sleep(500);

  clearInterval(keepalive);
  h.close();

  const ini1 = readMixerIni();
  const diffs = [];
  for (const k of new Set([...Object.keys(ini0), ...Object.keys(ini1)])) {
    if (ini0[k] !== ini1[k]) diffs.push([k, ini0[k], ini1[k]]);
  }
  console.log(`\n=== ИЗМЕНЕНИЯ В INI: ${diffs.length} ===`);
  for (const [k, a, b] of diffs.slice(0, 25)) console.log(`  ${k}: ${a} -> ${b}`);
  if (diffs.length === 0) console.log('  (нет — возможно, MCC не запущен и файл не обновлён)');
};

main().catch((err) => { console.error('ошибка:', err.message); process.exit(1); });
