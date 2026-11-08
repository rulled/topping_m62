/**
 * БАЗОВАЯ ПРОВЕРКА: работает ли HID-запись вообще.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Два теста подряд не смогли подтвердить запись даже туда, где она
 * ДОСТОВЕРНО работала раньше (компрессор). Значит под сомнением не EQ,
 * а САМ КАНАЛ ЗАПИСИ в текущей конфигурации.
 *
 * Проверяем максимально простую вещь: запись громкости Mic-1 (0x21:0x04).
 * Это тег, который шлёт драйвер, шкала линейная 0..88, значение видно
 * и в обратном чтении (0x21:04 шлётся как событие), и в INI.
 *
 * ═══ ТРИ СПОСОБА ПРОВЕРКИ ═══
 *
 *   1. Обратное чтение HID: метры/события 0x21:01..0x06 включают громкость?
 *   2. INI: [Input_IN1] — MCC пишет туда громкость.
 *   3. Сравнение: если запись принята, оба источника покажут новое значение.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Громкость Mic-1 — ВХОД, не выход. HP/OTG отключены. Значение ставим
 * МЕНЬШЕ текущего (тише), в конце возвращаем.
 *
 * Запуск: node src/tools/test-basic-write.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId, parseReport, isIdle, PP_HANDSHAKE } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readIniSection(name) {
  try {
    const txt = readFileSync(INI, 'utf8');
    const out = {};
    let inSec = false;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) {
        inSec = t === `[${name}]`;
        continue;
      }
      if (!inSec || !t) continue;
      const eq = t.indexOf('=');
      if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  } catch (err) {
    return { error: err.message };
  }
}

const isMccRunning = () => {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 20000, encoding: 'utf8' });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
};

async function main() {
  console.log('=== MCC ===');
  if (!isMccRunning()) {
    console.log('  запускаем…');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`], {
      timeout: 60000,
    });
    await sleep(12000);
  } else {
    console.log('  работает');
  }

  console.log('\n=== INI [Input_IN1] до ===');
  const iniBefore = readIniSection('Input_IN1');
  for (const [k, v] of Object.entries(iniBefore)) console.log(`  ${k} = ${v}`);

  // ---------- открываем устройство ----------
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 не найден');
    process.exit(1);
  }
  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  write(0x11, PP_HANDSHAKE, 1);
  await sleep(400);

  // ---------- читаем 0x21:04 (громкость Mic-1) ----------
  write(0x11, 0x24, 1);
  await sleep(200);
  write(0x11, 0x26, 1);

  const state = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    let buf;
    try {
      buf = h.readTimeout(20);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    if (isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    state.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
  }

  const curVol = state.get('21:04');
  console.log(`\n=== HID: 0x21:04 (Mic-1 volume) = ${curVol} ===`);
  console.log(`  всего адресов в дампе: ${state.size}`);
  console.log(`  HP=${state.get('64:06')} OTG=${state.get('62:06')}`);

  if (state.get('64:06') !== 0 || state.get('62:06') !== 0) {
    console.log('  СТОП: выход подключён.');
    h.close();
    process.exit(1);
  }

  // ---------- пишем ----------
  const target = curVol === undefined ? 40 : Math.max(0, curVol - 12);
  console.log(`\n=== пишем 0x21:04 -> ${target} (было ${curVol}) ===`);

  const keepalive = setInterval(() => {
    try {
      write(0x11, 0x24, 1);
    } catch {
      /* ok */
    }
  }, 2000);

  write(0x21, 0x04, target);
  await sleep(1500);
  // повтор — иногда первая запись теряется
  write(0x21, 0x04, target);
  await sleep(4000);

  // ---------- проверка 1: HID после записи ----------
  // переподключаемся с паузой, чтобы получить полный дамп
  try {
    h.close();
  } catch {
    /* ok */
  }
  clearInterval(keepalive);
  await sleep(900);

  const h2 = new HID.HID(dev.path);
  const write2 = (tt, pp, v) => h2.write([...withReportId(buildFrame(tt, pp, v, true))]);
  write2(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  write2(0x11, 0x24, 1);
  await sleep(150);
  write2(0x11, 0x26, 1);

  const after = new Map();
  const t1 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t1 < 6500) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h2.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      after.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      write2(0x11, 0x24, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try {
    h2.close();
  } catch {
    /* ok */
  }

  const newVol = after.get('21:04');
  console.log(`\n=== 1. обратное чтение HID: 0x21:04 = ${newVol} ===`);
  console.log(`  ${newVol === target ? 'СОВПАЛО с записанным' : 'не совпало'}`);

  // ---------- проверка 2: INI ----------
  await sleep(2000);
  const iniAfter = readIniSection('Input_IN1');
  console.log('\n=== 2. INI [Input_IN1] после ===');
  for (const [k, v] of Object.entries(iniAfter)) console.log(`  ${k} = ${v}`);

  // ---------- вывод ----------
  console.log('\n=== 3. итог ===');
  const hidOk = newVol === target;
  const iniChanged =
    JSON.stringify(iniBefore) !== JSON.stringify(iniAfter);
  console.log(`  обратное чтение HID подтверждает: ${hidOk ? 'ДА' : 'НЕТ'}`);
  console.log(`  INI изменился: ${iniChanged ? 'ДА' : 'НЕТ'}`);
  console.log('');
  if (hidOk) {
    console.log('  => ЗАПИСЬ РАБОТАЕТ, и обратное чтение её показывает.');
    console.log('     Значит предыдущие провалы — про EQ и компрессор, не про канал.');
  } else {
    console.log('  => Запись НЕ подтверждается даже на громкости.');
  }

  // ---------- восстановление ----------
  if (curVol !== undefined) {
    console.log(`\nвосстанавливаем 0x21:04 -> ${curVol}`);
    const h3 = new HID.HID(dev.path);
    const w3 = (tt, pp, v) => h3.write([...withReportId(buildFrame(tt, pp, v, true))]);
    w3(0x11, PP_HANDSHAKE, 1);
    await sleep(350);
    w3(0x21, 0x04, curVol);
    await sleep(1000);
    try {
      h3.close();
    } catch {
      /* ok */
    }
    console.log('  отправлено');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
