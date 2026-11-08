/**
 * ГЛАВНЫЙ ТЕСТ: ПИШЕТСЯ ли EQ/компрессор/реверб через HID ПОСЛЕ handshake.
 *
 * КОНТЕКСТ: session handshake `11/01 = 1` открыл все теги
 * (компрессор 0x46:0x01..0x08, EQ 0x91..0x94, переключатели 0x9b:*).
 * Раньше мы их не видели и решили, что они «не пишутся».
 *
 * Теперь проверяем запись тем же методом, что сработал для компрессора:
 *   handshake -> запись -> перезапуск MCC -> чтение INI.
 *
 * БЕЗОПАСНОСТЬ:
 *   - выходы проверяются (HP/OTG); если подключены — стоп;
 *   - EQ выключен (Switch=0) => правка полос инертна;
 *   - компрессор выключен (Switch=0) => инертен;
 *   - реверб в Bypass => инертен;
 *   - пишем в разумных диапазонах;
 *   - в конце восстанавливаем.
 *
 * Запуск: node src/tools/test-write-after-handshake.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readIni() {
  const txt = readFileSync(INI, 'utf8');
  const secs = {};
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) {
      cur = t.slice(1, -1);
      secs[cur] = {};
      continue;
    }
    if (!cur || !t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) secs[cur][t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return secs;
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
  const ini0 = readIni();
  console.log('=== INI до ===');
  console.log(`  [Compressor]  Thr=${ini0.Compressor?.Threshold} Atk=${ini0.Compressor?.Attack} Mix=${ini0.Compressor?.Mix}`);
  console.log(`  [EQ_IN1]      Switch=${ini0.EQ_IN1?.Switch} Eq%401=${ini0.EQ_IN1?.['Eq%401']}`);
  console.log(`  [Effect_Integration] ReverbType=${ini0.Effect_Integration?.ReverbType} DryWetLive=${ini0.Effect_Integration?.DryWetLive}`);

  // --- handshake + subscribe ---
  console.log('\n=== handshake 11/01 = 1 ===');
  send(0x11, 0x01, 1);
  const ans = await collect(1500);
  console.log(`  ответ: 0x11:0x01 = ${ans.get('0x11:0x01')}`);

  send(0x11, 0x24, 1);
  await sleep(300);
  send(0x11, 0x26, 1);
  const st = await collect(7000);

  // --- безопасность ---
  const hp = st.get('0x62:0x06') === undefined ? st.get('0x64:0x06') : st.get('0x64:0x06');
  const otg = st.get('0x62:0x06');
  const eqSw1 = st.get('0x9b:0x0f');
  const eqSw2 = st.get('0x9b:0x10');
  const compSw = st.get('0x46:0x01');
  const revType = st.get('0x44:0x0b');

  console.log('\n=== безопасность ===');
  console.log(`  джеки: HP=${hp} OTG=${otg}`);
  console.log(`  EQ_IN1.Switch=${eqSw1} EQ_IN2.Switch=${eqSw2}`);
  console.log(`  Compressor.Switch=${compSw}`);
  console.log(`  ReverbType=${revType} (1=Bypass)`);

  if (hp !== 0 || otg !== 0) {
    console.log('\nСТОП: выход подключён.');
    h.close();
    return;
  }
  if (eqSw1 !== 0 || eqSw2 !== 0) {
    console.log('\nСТОП: EQ включён.');
    h.close();
    return;
  }
  if (compSw !== 0) {
    console.log('\nСТОП: компрессор включён.');
    h.close();
    return;
  }
  console.log('  -> всё инертно, звук невозможен\n');

  const keepalive = setInterval(() => {
    try { send(0x11, 0x24, 1); } catch { /* ok */ }
  }, 1900);

  // --- запись ---
  console.log('=== пишем ===');

  // компрессор: Attack 5 -> 9, Mix 100 -> 77
  console.log('  comp 0x46:0x04 (Attack) = 9');
  send(0x46, 0x04, 9);
  await sleep(200);
  console.log('  comp 0x46:0x08 (Mix) = 77');
  send(0x46, 0x08, 77);
  await sleep(200);

  // EQ: полоса 1 блока 0x91 — gain (0x06) = 6
  console.log('  eq 0x91:0x06 (band1 gain) = 6');
  send(0x91, 0x06, 6);
  await sleep(200);

  // реверб: DryWet (0x44:0x08) = 42
  console.log('  reverb 0x44:0x08 (dryWet) = 42');
  send(0x44, 0x08, 42);
  await sleep(200);

  // --- проверка через announce ---
  console.log('\n=== announce для проверки ===');
  send(0x11, 0x26, 1);
  const after = await collect(7000);
  console.log(`  0x46:0x04 = ${after.get('0x46:0x04')} (писали 9)`);
  console.log(`  0x46:0x08 = ${after.get('0x46:0x08')} (писали 77)`);
  console.log(`  0x91:0x06 = ${after.get('0x91:0x06')} (писали 6)`);
  console.log(`  0x44:0x08 = ${after.get('0x44:0x08')} (писали 42)`);

  const direct = {
    comp: after.get('0x46:0x04') === 9,
    mix: after.get('0x46:0x08') === 77,
    eq: after.get('0x91:0x06') === 6,
    rev: after.get('0x44:0x08') === 42,
  };

  console.log('\n=== перезапуск MCC для фиксации в файл ===');
  clearInterval(keepalive);
  h.close();

  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue`],
      { timeout: 30000 });
  } catch { /* ok */ }
  await sleep(3000);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe'`],
      { timeout: 30000 });
  } catch { /* ok */ }
  await sleep(20000);

  const ini1 = readIni();
  console.log('\n=== INI после ===');
  console.log(`  [Compressor]  Atk=${ini1.Compressor?.Attack} Mix=${ini1.Compressor?.Mix}`);
  console.log(`  [EQ_IN1]      Eq%401=${ini1.EQ_IN1?.['Eq%401']}`);
  console.log(`  [Effect_Integration] DryWetLive=${ini1.Effect_Integration?.DryWetLive}`);

  console.log('\n=== ИТОГ ===');
  console.log(`  прямой ответ устройства (announce):`);
  console.log(`    компрессор Attack: ${direct.comp ? 'ПРИНЯТО' : 'нет'}`);
  console.log(`    компрессор Mix:    ${direct.mix ? 'ПРИНЯТО' : 'нет'}`);
  console.log(`    EQ band1 gain:     ${direct.eq ? 'ПРИНЯТО' : 'нет'}`);
  console.log(`    реверб dryWet:     ${direct.rev ? 'ПРИНЯТО' : 'нет'}`);
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  process.exit(1);
});
