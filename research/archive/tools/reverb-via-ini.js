/**
 * РЕВЕРБ ЧЕРЕЗ ФАЙЛ — без запущенного MCC.
 *
 * ═══ ЧТО УСТАНОВЛЕНО ═══
 *
 * Реверб НЕ пишется через HID: ни одиночным кадром, ни в брекете
 * 0x11:0x20 (проверено 2026-11-10, 0 из 4 оба раза). Значение
 * возвращается к прежнему.
 *
 * Но параметры реверба ЧИТАЮТСЯ из HID (теги 0x44:08/09/0a/0f)
 * и совпадают с INI по значению:
 *
 *   0x44:08 = 30  DryWetBypass = 30
 *   0x44:09 =  4  ReverbBypass = 4
 *   0x44:0a = 11  DecayBypass  = 11
 *   0x44:0f = 70  WidthBypass  = 0.7 (x100)
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Если записать значение в INI при ЗАКРЫТОМ MCC, а затем запустить
 * MCC — он прочитает файл и отправит значения в устройство. Тогда
 * запись реверба возможна без постоянно запущенного MCC: нужно
 * только кратковременно его запустить.
 *
 * Это не «полная автономность», но гораздо лучше, чем требовать
 * открытое окно и двигать дилы.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Снимок HID (запомнить значения 0x44:08/09/0a/0f).
 * 2. MCC закрыт. Правим DryWetBypass в INI: 30 -> 45.
 * 3. Запускаем MCC, ждём загрузки, закрываем.
 * 4. Снимок HID: изменился ли 0x44:08 на 45?
 * 5. Возвращаем INI и повторяем, чтобы вернуть значение.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * ReverbType = Bypass, реверб выключен — параметры на звук не влияют.
 * Наушники и OTG отключены (проверяется). INI бэкапится.
 *
 * Запуск: node src/tools/reverb-via-ini.js
 */

import HID from 'node-hid';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
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
const BACKUP = 'research/live-ini-backup.ini';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function freshSnapshot(ms = 16000) {
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
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target === 0x44) out.set(hex2(f.prop), f.value);
      if (f.target === 0x64 || f.target === 0x62) {
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch { /* ok */ }
  return out;
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

function mccStart() {
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'],
  { timeout: 20000 });
}

function mccKill() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force'],
    { timeout: 20000 });
  } catch { /* уже закрыт */ }
}

function mccRunning() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
    { encoding: 'utf8', timeout: 15000 }).trim();
    return Number(out) > 0;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(BACKUP)) {
    copyFileSync(INI, BACKUP);
    console.log(`бэкап INI: ${BACKUP}`);
  }

  console.log('снимок «до»…');
  const before = await freshSnapshot();
  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }

  const v08 = before.get('08');
  console.log(`  0x44:08 (DryWet) = ${v08}`);
  if (v08 === undefined) {
    console.log('  тег не пришёл — проверять нечего');
    process.exit(3);
  }

  const target = v08 === 45 ? 30 : 45;
  console.log(`\nплан: ${v08} -> ${target}`);

  if (mccRunning()) {
    console.log('закрываю MCC…');
    mccKill();
    await sleep(4000);
  }

  console.log(`правлю INI: DryWetBypass=${target}`);
  const okSet = iniSet('DryWetBypass', String(target));
  if (!okSet) {
    console.log('  ключ DryWetBypass не найден в [Effect_Integration]');
    process.exit(4);
  }

  console.log('запускаю MCC (он должен прочитать файл и отправить в устройство)…');
  mccStart();
  await sleep(22000);

  console.log('закрываю MCC…');
  mccKill();
  await sleep(5000);

  console.log('снимок «после»…');
  const after = await freshSnapshot();
  const got = after.get('08');
  const ok = got === target;

  console.log(`\n  0x44:08: ${v08} -> ${target} -> ${got}  ${ok ? 'ПРИМЕНЕНО' : 'нет'}`);
  console.log(`  INI: DryWetBypass = ${target}`);

  if (ok) {
    console.log(`\nвозвращаю ${v08} через тот же путь…`);
    iniSet('DryWetBypass', String(v08));
    mccStart();
    await sleep(22000);
    mccKill();
    await sleep(4000);
    const back = await freshSnapshot();
    console.log(`  откат: ${back.get('08') === v08 ? 'ОК' : 'ПРОВЕРЬ'}`);
  } else {
    console.log('\nне применилось. Возвращаю INI из бэкапа.');
    copyFileSync(BACKUP, INI);
  }

  console.log('\n' + '='.repeat(60));
  if (ok) {
    console.log('РЕВЕРБ ПИШЕТСЯ ЧЕРЕЗ ФАЙЛ + КРАТКОВРЕМЕННЫЙ ЗАПУСК MCC.');
    console.log('Значит /api/reverb можно сделать без ОТКРЫТОГО окна и');
    console.log('без движений дилов: правка файла + перезапуск MCC.');
    console.log('Это те же ~17 секунд, что уже делает /api/workspace/apply.');
  } else {
    console.log('Файл + перезапуск не помог. Реверб управляется только');
    console.log('через UI MCC (движение дилов), других путей нет.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
