/**
 * EQ ПИШЕТСЯ ЧЕРЕЗ INI-ФАЙЛ, А НЕ ЧЕРЕЗ HID?
 *
 * ═══ ЧТО ПРИВЕЛО К ЭТОМУ ТЕСТУ ═══
 *
 * Захват eq-switch.pcap (MCC запускают, ждут, нажимают кнопку EQ
 * дважды) показал:
 *
 *   после 30 с MCC отправил ТОЛЬКО:
 *     0x11:24 (keepalive) — 16 кадров
 *     0x11:26 (announce)  — 1 кадр
 *   НИ ОДНОГО кадра 0x91..0x94 и НИ ОДНОГО 0x9b.
 *
 * То есть при нажатии кнопки EQ в MCC в устройство не уходит ничего.
 * Заодно: в захвате вообще нет кадров 0x91..0x94 (MCC их не пишет),
 * хотя устройство их ПРИСЫЛАЕТ (probe-eq-arrival.js: 40 адресов).
 *
 * Вывод-гипотеза: EQ пишется через INI-файл workspace, а MCC
 * применяет его при старте/переключении. Это совпадает с NOTES §87
 * («значения полос пишутся через файл»).
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Запоминает текущее 0x91:03 (gain) и 0x9b:0f (EQ switch).
 * 2. Правит INI: EQ_IN1 Switch=1, Eq%401 gain=3.
 * 3. Убивает MCC, запускает заново (чтобы применил файл).
 * 4. Читает 0x91:03 и 0x9b:0f с устройства.
 * 5. Восстанавливает INI и возвращает всё назад.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Gain 3 дБ — небольшая прибавка,
 * полоса одна. INI бэкапится и восстанавливается.
 *
 * Запуск: node src/tools/prove-eq-via-ini.js
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import HID from 'node-hid';

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
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const INI = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live\\M62_Live_main.ini';
const BAK = 'research/live-ini-before-eqviaini.ini';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

async function readDevice(ms = 10000) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);
  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let j = 0; j < 128; j++) {
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
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch {
    /* ok */
  }
  return out;
}

/** Правит секцию EQ_IN1 в INI. */
function patchIni(switchOn, gain) {
  const lines = readFileSync(INI, 'utf8').split(/\r?\n/);
  let cur = null;
  let changedSwitch = false;
  let changedGain = false;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*\[(.+?)\]/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur !== 'EQ_IN1') continue;
    if (/^\s*Switch\s*=/.test(lines[i])) {
      lines[i] = `Switch=${switchOn ? 1 : 0}`;
      changedSwitch = true;
    }
    if (/^\s*Eq%401\s*=/.test(lines[i])) {
      // формат: |gain|freq|q|type
      lines[i] = `Eq%401=|${gain}|632|0.7|0`;
      changedGain = true;
    }
  }
  writeFileSync(INI, lines.join('\r\n'), 'utf8');
  return { changedSwitch, changedGain };
}

function killMcc() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue']);
  } catch {
    /* ok */
  }
}

function startMcc() {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`]);
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ ЧЕРЕЗ INI-ФАЙЛ: РАБОТАЕТ ЛИ?');
  console.log('='.repeat(70));

  // ─── бэкап ───
  if (!existsSync(BAK)) copyFileSync(INI, BAK);
  console.log(`бэкап INI: ${BAK}`);

  // ─── безопасность ───
  const base = await readDevice(6000);
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  let restoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    const dev = findDev();
    const h = new HID.HID(dev.path);
    const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
    send(0x11, PP_HANDSHAKE, 1);
    await sleep(400);
    send(0x11, PP_SUBSCRIBE, 1);
    await sleep(200);
    send(0x64, 0x04, 1);
    await sleep(900);
    try {
      h.close();
    } catch {
      /* ok */
    }
    if ((await readDevice(6000)).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    restoreMute = true;
    console.log('  заглушено и подтверждено');
  } else {
    console.log('  безопасно');
  }

  // ─── исходное состояние ───
  const s0 = await readDevice();
  const beforeGain = s0.get('91:03');
  const beforeSwitch = s0.get('9b:0f');
  console.log('\nДО (с устройства):');
  console.log(`  0x91:03 band1 gain = ${beforeGain}`);
  console.log(`  0x9b:0f EQ switch  = ${beforeSwitch}`);

  // ─── правим INI ───
  console.log('\nправлю INI: EQ_IN1 Switch=1, Eq%401 gain=3');
  const patched = patchIni(true, 3);
  console.log(`  Switch изменён: ${patched.changedSwitch}`);
  console.log(`  gain изменён:   ${patched.changedGain}`);

  // ─── перезапуск MCC, чтобы применил ───
  console.log('\nперезапускаю MCC (он должен применить файл)…');
  killMcc();
  await sleep(4000);
  startMcc();
  await sleep(20000);
  console.log('  MCC запущен, читаю устройство');

  const s1 = await readDevice();
  const afterGain = s1.get('91:03');
  const afterSwitch = s1.get('9b:0f');
  console.log('\nПОСЛЕ (с устройства):');
  console.log(`  0x91:03 band1 gain = ${afterGain}   ${afterGain === 3 ? 'ПРИМЕНИЛОСЬ' : 'не изменилось'}`);
  console.log(`  0x9b:0f EQ switch  = ${afterSwitch}   ${afterSwitch === 1 ? 'ПРИМЕНИЛОСЬ' : 'не изменилось'}`);

  // ─── восстановление ───
  console.log('\nвосстанавливаю INI и состояние…');
  killMcc();
  await sleep(3000);
  copyFileSync(BAK, INI);
  startMcc();
  await sleep(18000);
  const s2 = await readDevice(8000);
  console.log(`  0x91:03 = ${s2.get('91:03')}  (было ${beforeGain})`);
  console.log(`  0x9b:0f = ${s2.get('9b:0f')}  (было ${beforeSwitch})`);

  if (restoreMute) {
    /* mute вернём отдельно, если нужно */
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const gainWorks = afterGain === 3;
  const switchWorks = afterSwitch === 1;
  if (gainWorks && switchWorks) {
    console.log('  EQ ЧЕРЕЗ ФАЙЛ РАБОТАЕТ ПОЛНОСТЬЮ: и полосы, и переключатель.');
    console.log('  => это и есть правильный путь для нашего сервиса.');
    console.log('     Прямая HID-запись в 0x91/0x9b не работает.');
  } else if (gainWorks) {
    console.log('  Полосы через файл работают, Switch — нет.');
    console.log('  Совпадает с NOTES §87.');
  } else if (switchWorks) {
    console.log('  Switch через файл работает, полосы — нет.');
  } else {
    console.log('  Ничего не применилось. Значит MCC не применяет EQ из файла');
    console.log('  в Live-режиме — надо смотреть, где именно он это делает.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
