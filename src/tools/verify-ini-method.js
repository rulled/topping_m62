/**
 * ПРОВЕРКА САМОГО МЕТОДА: работает ли «правка INI + перезапуск MCC».
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `reverb-via-ini.js` записал DryWetBypass=45 в файл, перезапустил
 * MCC — устройство осталось на 30. Возможны два объяснения:
 *
 *   A. Метод вообще не работает (MCC не отправляет файл в устройство).
 *   B. Метод работает, но реверб — исключение.
 *
 * Чтобы различить, берём параметр, про который ТОЧНО известно, что
 * он управляется через файл: уровень FX входа IN1 (`Input1Level`,
 * тег `0x44:01`). Если он применится, а реверб нет — значит реверб
 * действительно особый случай.
 *
 * ═══ ДОПОЛНИТЕЛЬНО ═══
 *
 * Скрипт НЕ восстанавливает файл сразу, а сначала смотрит, что стало
 * с файлом после работы MCC: перезаписал ли MCC его своей копией.
 * Это важно для понимания, кто здесь источник истины.
 *
 * Запуск: node src/tools/verify-ini-method.js
 */

import HID from 'node-hid';
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini`;
const BACKUP = 'research/live-ini-backup2.ini';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 16000) {
  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target === 0x44) out.set(hex2(f.prop), f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }
  return out;
}

function iniGet(key) {
  let cur = null;
  for (const line of readFileSync(INI, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) { cur = m[1]; continue; }
    if (cur !== 'Effect_Integration') continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    if (t.slice(0, eq).trim() === key) return t.slice(eq + 1).trim();
  }
  return null;
}

function iniSet(key, value) {
  const lines = readFileSync(INI, 'utf8').split(/\r?\n/);
  let cur = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) { cur = m[1]; continue; }
    if (cur !== 'Effect_Integration') continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    if (t.slice(0, eq).trim() === key) {
      lines[i] = `${key}=${value}`;
      changed = true;
    }
  }
  if (changed) writeFileSync(INI, lines.join('\n'), 'utf8');
  return changed;
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 25000 }).trim();
  } catch { return ''; }
};

const mccRunning = () =>
  Number(ps("(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count")) > 0;

async function main() {
  if (!existsSync(BACKUP)) {
    copyFileSync(INI, BACKUP);
    console.log(`бэкап: ${BACKUP}`);
  }

  const before = await snap();
  const fx1 = before.get('01');   // FX IN1 level
  const reverb = before.get('08'); // DryWet (гипотеза)

  console.log(`0x44:01 (FX IN1 level) = ${fx1}   INI Input1Level = ${iniGet('Input1Level')}`);
  console.log(`0x44:08 (DryWet)       = ${reverb}   INI DryWetBypass = ${iniGet('DryWetBypass')}`);

  if (fx1 === undefined) {
    console.log('тег 0x44:01 не пришёл — нечего проверять');
    process.exit(3);
  }

  // Берём заведомо рабочий параметр: уровень FX IN1.
  const newFx = fx1 === -6 ? -12 : -6;
  console.log(`\nменяю в файле Input1Level: ${iniGet('Input1Level')} -> ${newFx}`);
  iniSet('Input1Level', String(newFx));

  if (mccRunning()) { ps('Get-Process -Name "M Control Center" | Stop-Process -Force'); await sleep(4000); }

  console.log('запускаю MCC…');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(24000);

  const iniAfterRun = iniGet('Input1Level');
  console.log(`  файл после работы MCC: Input1Level = ${iniAfterRun}`);
  if (iniAfterRun !== String(newFx)) {
    console.log('  MCC ПЕРЕЗАПИСАЛ файл своей копией — значит он не читает файл при старте');
  }

  ps('Get-Process -Name "M Control Center" | Stop-Process -Force');
  await sleep(5000);

  const after = await snap();
  const fxGot = after.get('01');
  const okFx = fxGot === newFx;

  console.log(`\n0x44:01: ${fx1} -> ${newFx} -> ${fxGot}  ${okFx ? 'ПРИМЕНЕНО' : 'нет'}`);
  console.log(`0x44:08 (DryWet, не трогали): ${reverb} -> ${after.get('08')}`);

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));

  if (okFx) {
    console.log('  Метод «правка INI + перезапуск MCC» РАБОТАЕТ.');
    console.log('  Значит реверб — особый случай: его параметры в файле');
    console.log('  есть, но устройство их оттуда не берёт.');
    console.log('  Вывод: реверб управляется ТОЛЬКО движением дилов в UI.');
  } else {
    console.log('  Метод не работает даже на заведомо файловом параметре.');
    console.log('  Значит MCC при старте НЕ отправляет файл в устройство,');
    console.log('  а берёт состояние из устройства. Тогда источник истины —');
    console.log('  устройство, и INI лишь его отражение.');
    console.log('  Это меняет всю модель: правка файла бессмысленна.');
  }

  console.log(`\nвозвращаю INI из бэкапа…`);
  copyFileSync(BACKUP, INI);
  console.log(`  Input1Level = ${iniGet('Input1Level')}, DryWetBypass = ${iniGet('DryWetBypass')}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
