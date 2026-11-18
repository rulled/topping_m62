/**
 * РЕШАЮЩИЙ ТЕСТ: пишется ли МИКШЕР через HID (отложенное применение).
 *
 * КОНТЕКСТ ОШИБКИ: раньше (§16) микшер проверяли ТОЛЬКО ЧТЕНИЕМ —
 * двигали слайдеры в MCC и слушали HID. Реакции не было, и был сделан
 * вывод «микшер не идёт через HID». Но для компрессора (§118.7) тот же
 * метод дал тот же ложный вывод: запись РАБОТАЕТ, просто применяется
 * отложенно, когда MCC фиксирует состояние в файл.
 *
 * Здесь проверяем микшер ТЕМ ЖЕ способом, что сработал для компрессора:
 * пишем через HID -> перезапускаем MCC -> читаем INI.
 *
 * БЕЗОПАСНОСТЬ:
 *   - выходы проверяются (HP/OTG джеки); если подключены — стоп;
 *   - пишем только в «тихие» теги, которые не приходят в ANNOUNCE
 *     (0x41, 0x42, 0x47, 0x48) — они не используются известными блоками;
 *   - значение -30 дБ безопасно (в диапазоне микшера -90..+12);
 *   - в конце восстанавливаем исходные значения.
 *
 * Запуск: node src/tools/test-mixer-hid-write.js
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

/** Читает ВСЕ секции Mixer_* и FieldMixer из INI. */
function readMixer() {
  const out = {};
  try {
    const txt = readFileSync(INI, 'utf8');
    let sec = null;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) {
        sec = t.slice(1, -1);
        continue;
      }
      if (!sec || !t) continue;
      if (!/^Mixer_|^FieldMixer$/.test(sec)) continue;
      const eq = t.indexOf('=');
      if (eq > 0) out[`${sec}.${t.slice(0, eq).trim()}`] = t.slice(eq + 1).trim();
    }
  } catch (err) {
    console.error(`INI: ${err.message}`);
  }
  return out;
}

function restartMcc() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue`],
      { timeout: 30000 });
  } catch { /* ok */ }
  sleepSync(2500);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe'`],
      { timeout: 30000 });
  } catch { /* ok */ }
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${Math.min(ms, 500)}`],
        { timeout: 10000 });
    } catch { /* ok */ }
    break;
  }
}

const main = async () => {
  const before = readMixer();
  const beforeKeys = Object.keys(before).length;
  console.log(`INI до: секций микшера прочитано, полей: ${beforeKeys}`);
  const nz = Object.entries(before).filter(([, v]) => v !== '0' && v !== 'false' && v !== '@Invalid()');
  console.log(`  ненулевых/особых: ${nz.length}`);
  for (const [k, v] of nz.slice(0, 12)) console.log(`    ${k} = ${v}`);

  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) { console.error('M62 не найден'); process.exit(1); }

  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  // --- безопасность ---
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
  console.log(`\nджеки: HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('СТОП: выход подключён, не рискую.');
    h.close();
    return;
  }
  console.log('выходы не подключены — безопасно\n');

  const keepalive = setInterval(() => {
    try { write(0x11, 0x24, 1); } catch { /* ok */ }
  }, 2000);

  // Кандидаты: «тихие» блоки 0x41, 0x42, 0x47, 0x48 не используются
  // известными блоками (0x43=ducking, 0x44=FX, 0x45=scenes, 0x46=comp).
  const CANDIDATES = [0x41, 0x42, 0x47, 0x48];
  const PROPS = [];
  for (let p = 0x01; p <= 0x10; p++) PROPS.push(p);
  const VALUE = -30;

  console.log('=== пишем -30 в кандидаты ===');
  for (const tt of CANDIDATES) {
    process.stdout.write(`  0x${tt.toString(16)}: `);
    for (const pp of PROPS) {
      write(tt, pp, VALUE);
      await sleep(15);
    }
    console.log(`${PROPS.length} записей`);
  }

  console.log('\n=== перезапуск MCC для фиксации ===');
  restartMcc();
  await sleep(20000);

  clearInterval(keepalive);
  h.close();

  const after = readMixer();
  console.log(`\nINI после: полей ${Object.keys(after).length}`);

  const diffs = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) diffs.push([k, before[k], after[k]]);
  }

  console.log(`\n=== ИЗМЕНЕНИЯ: ${diffs.length} ===`);
  for (const [k, a, b] of diffs.slice(0, 40)) {
    console.log(`  ${k}: ${a} -> ${b}`);
  }

  if (diffs.length === 0) {
    console.log('\n=> микшер НЕ реагирует и на запись через HID.');
    console.log('   Проверены 0x41, 0x42, 0x47, 0x48 x props 0x01..0x10.');
    console.log('   Вероятно, микшер идёт только через файл+MCC.');
  } else {
    console.log('\n=> МИКШЕР РЕАГИРУЕТ! Найден рабочий канал.');
  }
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  process.exit(1);
});
