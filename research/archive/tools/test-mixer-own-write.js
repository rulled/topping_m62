/**
 * ЗАПИСЬ МИКШЕРА НАШИМ КОДОМ — финальная проверка автономности.
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Можем ли МЫ, без MCC, записать микшер через bulk push, используя
 * расшифрованную карту из `src/mixer-tags.js`.
 *
 * Проверка — через тот же приём, что сработал для расшифровки:
 *   1. MCC закрыт.
 *   2. Пишем матрицу нашим кодом.
 *   3. Запускаем MCC.
 *   4. MCC читает состояние ИЗ УСТРОЙСТВА и пишет в INI.
 *   5. Смотрим INI: если наши значения там — запись применилась.
 *
 * ═══ ВАЖНО ═══
 *
 * В прошлый раз MCC при старте брал микшер из INI и отправлял В устройство.
 * Сейчас проверяем обратное: применилась ли НАША запись. Если MCC при
 * старте перезапишет её своими значениями из INI — значит не применилась.
 *
 * Чтобы различить: перед тестом ставим в INI ОДНО значение-маркер
 * (например MixB PB12 = -3 дБ), а нашим кодом пишем ДРУГОЕ (-25 дБ).
 * Если в INI после старта MCC окажется -25 — это наше, MCC подтвердил.
 * Если -3 — MCC взял из файла, наша запись не применилась.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены. Все значения отрицательные (тише unity).
 * INI восстанавливается из бэкапа.
 *
 * Запуск: node src/tools/test-mixer-own-write.js
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId, parseReport, isIdle, PP_HANDSHAKE, PP_BULK_BEGIN, PP_ANNOUNCE } from '../protocol.js';
import { buildMixerPacket } from '../mixer-tags.js';

const VID = 0x152a;
const PID = 0x875c;
const WS_ROOT = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live';
const REG_KEY = 'HKCU:\\Software\\TOPPING\\TOPPING Professional Control Center\\M62';
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Маркер в INI — чтобы отличить нашу запись от файла. */
const INI_MARKER_DB = -3;
/** Что пишем нашим кодом. */
const OUR_DB = -25;

function activeIni() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `(Get-ItemProperty -Path '${REG_KEY}' -Name 'M62_Live_Workspace').M62_Live_Workspace`],
    { encoding: 'utf8', timeout: 20000 }).trim();
  return path.join(WS_ROOT, `M62_Live_${out}.ini`);
}

function mccRunning() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
    { encoding: 'utf8', timeout: 20000 }).trim();
  return Number(out) > 0;
}

function stopMcc() {
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Seconds 2; Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }; exit 0"],
    { encoding: 'utf8', timeout: 60000 });
}

function readIniValue(file, section, key) {
  const txt = readFileSync(file, 'utf8');
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) { cur = t.slice(1, -1); continue; }
    if (cur === section && t.startsWith(`${key}=`)) return t.slice(key.length + 1).trim();
  }
  return null;
}

/** Правит значение в INI, сохраняя отсутствие BOM. */
function patchIni(file, section, key, value) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t.startsWith('[')) { cur = t.slice(1, -1); continue; }
    if (cur === section && t.startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      break;
    }
  }
  writeFileSync(file, lines.join('\r\n'), { encoding: 'utf8' });
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) { console.error('M62 не найден'); process.exit(1); }

async function main() {
  const ini = activeIni();
  const bak = `${ini}.bak-ownwrite`;
  console.log('=== 0. подготовка ===');
  console.log(`  INI: ${ini}`);

  if (mccRunning()) { console.log('  закрываю MCC…'); stopMcc(); await sleep(2500); }
  console.log(`  MCC: ${mccRunning() ? 'ВСЁ ЕЩЁ РАБОТАЕТ' : 'закрыт'}`);
  if (mccRunning()) { console.error('  не смог закрыть MCC'); process.exit(1); }

  copyFileSync(ini, bak);
  console.log(`  бэкап: ${bak}`);

  // маркер в файле
  patchIni(ini, 'Mixer_PB12', 'MixB_GAIN', String(INI_MARKER_DB));
  console.log(`  маркер в INI: Mixer_PB12.MixB_GAIN = ${INI_MARKER_DB}`);

  // ---------- проверка безопасности ----------
  console.log('\n=== 1. проверка выходов ===');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, 0x24, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  let hp = null;
  let otg = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    let buf;
    try { buf = h.readTimeout(20); } catch { break; }
    if (!buf || !buf.length || isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    if (f.target === 0x64 && f.prop === 0x06) hp = f.value;
    if (f.target === 0x62 && f.prop === 0x06) otg = f.value;
  }
  console.log(`  HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён.');
    copyFileSync(bak, ini);
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  // ---------- пишем микшер нашим кодом ----------
  console.log('\n=== 2. пишем микшер через bulk push (наш код) ===');
  console.log(`  Mix B, PB12 = ${OUR_DB} дБ, остальные — mute`);

  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(120);

  // Точный порядок MCC: свойство за свойством по всем группам.
  // 200 кадров за один проход.
  const state = { b: { pb12: OUR_DB } };
  const packet = buildMixerPacket(state);
  for (const frame of packet) {
    send(frame.target, frame.prop, frame.value);
    await sleep(2);
  }
  console.log(`  отправлено ${packet.length} кадров`);

  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(200);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(1500);
  try { h.close(); } catch { /* ok */ }
  console.log('  брекет закрыт, дамп запрошен');

  // ---------- MCC читает и пишет INI ----------
  console.log('\n=== 3. запускаю MCC — он прочитает устройство ===');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`],
    { timeout: 60000 });
  await sleep(25000);
  console.log('  MCC загрузился');

  const fromDevice = readIniValue(ini, 'Mixer_PB12', 'MixB_GAIN');
  console.log(`\n=== 4. INI после старта MCC: Mixer_PB12.MixB_GAIN = ${fromDevice} ===`);

  // ---------- вывод ----------
  console.log('\n=== 5. ВЫВОД ===');
  if (Number(fromDevice) === OUR_DB) {
    console.log(`  Наша запись ПРИМЕНИЛАСЬ: MCC прочитал из устройства ${OUR_DB} дБ.`);
    console.log('  Микшер управляется нашим кодом без MCC.');
  } else if (Number(fromDevice) === INI_MARKER_DB) {
    console.log(`  Наша запись НЕ применилась: MCC взял из файла ${INI_MARKER_DB} дБ.`);
    console.log('  Значит MCC игнорирует запись микшера от другого источника.');
  } else {
    console.log(`  Неожиданное значение ${fromDevice}. Проверь вручную.`);
  }

  // ---------- восстановление ----------
  console.log('\n=== 6. восстановление ===');
  stopMcc();
  await sleep(2500);
  copyFileSync(bak, ini);
  console.log('  INI восстановлен из бэкапа');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
