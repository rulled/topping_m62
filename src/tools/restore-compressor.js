/**
 * Восстановление компрессора через HID (проверенный рабочий путь).
 *
 * ПРОБЛЕМА: правка INI-файла не держится, если MCC запущен — он держит
 * состояние в памяти и перезаписывает файл при выходе.
 *
 * РЕШЕНИЕ: писать через HID (0x46:0x02..0x08) — это канал, который
 * МЕНЯЕТ состояние самого устройства, а MCC потом фиксирует его в файл.
 * Проверено в test-comp-write-v2.js: 4 из 6 параметров записались.
 *
 * БЕЗОПАСНОСТЬ: компрессор выключен, выходы проверяются.
 *
 * Запуск: node src/tools/restore-compressor.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live\\M62_Live_main.ini';

/** Эталонные значения. */
const TARGET = [
  [0x01, 'Switch', 0],
  [0x02, 'Threshold', -28],
  [0x03, 'Ratio', 40],      // 4.0 * 10
  [0x04, 'Attack', 5],
  [0x05, 'Release', 200],
  [0x06, 'Gain', 10],
  [0x08, 'Mix', 100],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readIni() {
  try {
    const txt = readFileSync(INI, 'utf8');
    const out = {};
    let inSec = false;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) { inSec = t === '[Compressor]'; continue; }
      if (!inSec || !t) continue;
      const eq = t.indexOf('=');
      if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  } catch { return {}; }
}

const main = async () => {
  const before = readIni();
  console.log(`INI до:     Thr=${before.Threshold} Atk=${before.Attack} Rel=${before.Release} Gain=${before.Gain} Mix=${before.Mix}`);

  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) { console.error('M62 не найден'); process.exit(1); }

  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  // безопасность: выходы
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
    console.log('СТОП: выход подключён');
    h.close();
    return;
  }

  console.log('\n=== пишем эталон через HID ===');
  for (const [prop, name, val] of TARGET) {
    write(0x46, prop, val);
    console.log(`  ${name} -> ${val}`);
    await sleep(300);
  }

  console.log('\n=== перезапускаем MCC, чтобы он зафиксировал в файл ===');
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
  h.close();

  const after = readIni();
  console.log(`\nINI после:  Thr=${after.Threshold} Atk=${after.Attack} Rel=${after.Release} Gain=${after.Gain} Mix=${after.Mix}`);

  const ok =
    after.Threshold === '-28' &&
    after.Attack === '5' &&
    after.Release === '200' &&
    after.Mix === '100';
  console.log(`\n=> восстановлено: ${ok ? 'ДА' : 'НЕТ'}`);
};

main().catch((err) => { console.error('ошибка:', err.message); process.exit(1); });
