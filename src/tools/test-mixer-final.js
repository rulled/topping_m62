/**
 * МИКШЕР по Q25 — последняя крупная проверка.
 *
 * ИЗ PROTOCOL.md (NTMan/topping-m62):
 *   Target = микс + канал (Mix A = 0x31/0x32, B = 0x33/0x34, C = 0x35/0x36)
 *   Property = ИСТОЧНИК (01/02 = Playback 1/2, ..., 09/0a = IN, 0b/0c = AUX,
 *                         0d/0e = BT, 0f/10 = OTG)
 *   Value = Q25 (2^25 = 33554432 = 0 dB, 0 = mute)
 *
 * ВАЖНО: у нас 0x31..0x36 в announce НЕ приходили (только метры 0x3x:0x15).
 * Значит микшер надо писать «вслепую» и проверять по INI-файлу.
 *
 * БЕЗОПАСНОСТЬ:
 *   - handshake обязателен;
 *   - выходы проверяются: при подключённых HP/OTG — СТОП;
 *   - пишем ТИШЕ текущего (только вниз), значение -20 dB;
 *   - в конце возвращаем unity (0 dB) в те же теги.
 *
 * Запуск: node src/tools/test-mixer-final.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live\\M62_Live_main.ini';

const Q25_UNITY = 33554432;      // 0 dB
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbToQ25 = (db) => Math.round(Math.pow(10, db / 20) * Q25_UNITY);

function readMixer() {
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

const main = async () => {
  const ini0 = readMixer();
  console.log('=== INI до (ненулевые) ===');
  const nz0 = Object.entries(ini0).filter(([, v]) => v !== '0' && v !== 'false');
  console.log(`  полей: ${Object.keys(ini0).length}, ненулевых: ${nz0.length}`);
  for (const [k, v] of nz0.slice(0, 8)) console.log(`    ${k} = ${v}`);

  // handshake
  send(0x11, 0x01, 1);
  const a = await collect(1200);
  console.log(`\nhandshake: 11/01 = ${a.get('0x11:0x01')}`);
  send(0x11, 0x24, 1);
  await sleep(300);
  send(0x11, 0x26, 1);
  const st = await collect(7000);

  const hp = st.get('0x64:0x06') ?? 0;
  const otg = st.get('0x62:0x06') ?? 0;
  console.log(`джеки: HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён.');
    h.close();
    return;
  }
  const mixerTags = [...st.keys()].filter((k) => /^0x3[1-6]:/.test(k) && !k.endsWith(':0x15'));
  console.log(`тегов микшера в announce: ${mixerTags.length} ${mixerTags.slice(0, 10).join(' ')}`);

  const ka = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 1900);

  // --- пишем: Mix A / IN = -20 dB (обе стороны) ---
  const q = dbToQ25(-20);
  console.log(`\n=== пишем Mix A / IN (0x31:0x09, 0x32:0x0a) = -20 dB (Q25=${q}) ===`);
  send(0x31, 0x09, q);
  await sleep(200);
  send(0x32, 0x0a, q);
  await sleep(200);

  // --- также Mix A / Playback 1/2 = -20 dB ---
  console.log('=== пишем Mix A / Playback 1/2 (0x31:0x01, 0x32:0x02) = -20 dB ===');
  send(0x31, 0x01, q);
  await sleep(200);
  send(0x32, 0x02, q);
  await sleep(200);

  console.log('\n=== save 11/05 = 1 ===');
  send(0x11, 0x05, 1);
  await sleep(600);

  // --- читаем announce ---
  send(0x11, 0x26, 1);
  const after = await collect(7000);
  console.log('\n=== что говорит устройство ===');
  for (const k of ['0x31:0x01', '0x31:0x09', '0x32:0x02', '0x32:0x0a']) {
    console.log(`  ${k} = ${after.get(k)}`);
  }

  clearInterval(ka);
  h.close();

  // --- перезапуск MCC для фиксации в файл ---
  console.log('\n=== перезапуск MCC ===');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue`], { timeout: 30000 });
  } catch { /* ok */ }
  await sleep(3000);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe'`], { timeout: 30000 });
  } catch { /* ok */ }
  await sleep(20000);

  const ini1 = readMixer();
  const diffs = [];
  for (const k of new Set([...Object.keys(ini0), ...Object.keys(ini1)])) {
    if (ini0[k] !== ini1[k]) diffs.push([k, ini0[k], ini1[k]]);
  }
  console.log(`\n=== ИЗМЕНЕНИЯ: ${diffs.length} ===`);
  for (const [k, x, y] of diffs.slice(0, 30)) console.log(`  ${k}: ${x} -> ${y}`);
  if (diffs.length === 0) {
    console.log('  нет изменений — микшер через HID не пишется');
  } else {
    console.log('\n=> МИКШЕР ПИШЕТСЯ ЧЕРЕЗ HID');
  }
};

main().catch((e) => { console.error('ошибка:', e.message); process.exit(1); });
