/**
 * Проверка: РАБОТАЕТ ли запись компрессора через HID.
 *
 * ОСНОВАНИЕ: перебор probe-mixer-write.js записал -90 в 0x46:0x02..0x05
 * и это ОТРАЗИЛОСЬ в INI (Threshold=-90, Attack=-90 и т.д.).
 * Значит канал работает — просто применяется отложенно.
 *
 * НАСТОЯЩИЙ ТЕСТ: пишем валидные значения, затем принудительно
 * заставляем MCC переписать файл (перезапуск MCC или Load preset),
 * и читаем INI.
 *
 * БЕЗОПАСНОСТЬ:
 *  - компрессор ВЫКЛЮЧЕН (Switch=false) — правка инертна;
 *  - выходы проверяются: если подключены — стоп;
 *  - итоговые значения возвращаются к исходным.
 *
 * Запуск: node src/tools/test-comp-write-v2.js
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

function readIniSection(name) {
  try {
    const txt = readFileSync(INI, 'utf8');
    const out = {};
    let inSec = false;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) { inSec = t === `[${name}]`; continue; }
      if (!inSec || !t) continue;
      const eq = t.indexOf('=');
      if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  } catch (err) {
    return { error: err.message };
  }
}

function restartMcc() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue;
       Start-Sleep -Seconds 2;
       Start-Process 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe'`],
      { timeout: 60000, encoding: 'utf8' });
    return true;
  } catch (err) {
    console.log(`    перезапуск MCC: ${err.message}`);
    return false;
  }
}

const fmt = (c) =>
  `Thr=${c.Threshold} Ratio=${c.Ratio} Atk=${c.Attack} Rel=${c.Release} Gain=${c.Gain} Mix=${c.Mix}`;

const main = async () => {
  const c0 = readIniSection('Compressor');
  console.log(`INI до:        ${fmt(c0)}`);

  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) { console.error('M62 не найден'); process.exit(1); }

  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  // --- проверка безопасности: выходы ---
  write(0x11, 0x24, 1);
  await sleep(300);
  write(0x11, 0x26, 1);
  const jacks = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    let buf;
    try { buf = h.readTimeout(30); } catch { break; }
    if (!buf || !buf.length) continue;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = b;
    if (!(b[0] === 0x22 && b[1] === 0x33) && b[1] === 0x22) f = b.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    if (f[6] === 0x06) jacks.set(f[5], f.readInt32BE(7));
  }
  const hp = jacks.get(0x64) ?? 0;
  const otg = jacks.get(0x62) ?? 0;
  console.log(`джеки: HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён, не рискую.');
    h.close();
    return;
  }
  console.log('выходы не подключены — безопасно\n');

  // --- пишем валидные значения ---
  const keepalive = setInterval(() => {
    try { write(0x11, 0x24, 1); } catch { /* ok */ }
  }, 2000);

  const targets = [
    [0x02, 'Threshold', -30],
    [0x03, 'Ratio', 40],      // 4.0 * 10
    [0x04, 'Attack', 6],
    [0x05, 'Release', 250],
    [0x06, 'Gain', 8],
    [0x08, 'Mix', 90],
  ];

  console.log('=== пишем через HID 0x46 ===');
  for (const [prop, name, val] of targets) {
    write(0x46, prop, val);
    console.log(`  ${name} -> ${val}`);
    await sleep(300);
  }

  console.log('\n=== перезапускаем MCC, чтобы он применил и записал файл ===');
  restartMcc();
  await sleep(18000);

  clearInterval(keepalive);
  const c1 = readIniSection('Compressor');
  console.log(`INI после:     ${fmt(c1)}`);

  const changed =
    c1.Threshold === '-30' && c1.Attack === '6' && c1.Mix === '90';
  console.log(`\n=> HID-запись компрессора ${changed ? 'ПОДТВЕРЖДЕНА' : 'не подтверждена'}`);

  if (!changed) {
    console.log('\nвозвращаем исходные значения...');
    const h2 = new HID.HID(dev.path);
    const w2 = (tt, pp, v) => h2.write([...withReportId(buildFrame(tt, pp, v, true))]);
    w2(0x11, 0x24, 1);
    await sleep(300);
    for (const [prop, , val] of targets) {
      const orig = c0[prop === 0x02 ? 'Threshold'
        : prop === 0x03 ? 'Ratio'
        : prop === 0x04 ? 'Attack'
        : prop === 0x05 ? 'Release'
        : prop === 0x06 ? 'Gain' : 'Mix'];
      if (orig !== undefined) {
        w2(0x46, prop, Number(orig));
        await sleep(200);
      }
    }
    h2.close();
    console.log('  отправлено исходное');
  }

  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  process.exit(1);
});
