/**
 * 48V: ЧТЕНИЕ ЕСТЬ, ЗАПИСЬ — ПРОВЕРИТЬ ВСЕ СПОСОБЫ.
 *
 * ═══ ЧТО УЖЕ УСТАНОВЛЕНО ═══
 *
 * `0x11:0x19` — это 48V для IN1. Доказано нажатием кнопки в MCC:
 * тег 0 -> 1, других изменений нет.
 *
 * Прямая запись `send(0x11, 0x19, 0)` НЕ применилась: значение
 * осталось 1. Но это ещё не значит «не пишется» — в проекте уже
 * было несколько случаев, когда нужен был брекет.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Одиночный кадр (уже не сработал — повторяем для контроля).
 * 2. В брекете 0x11:0x20.
 * 3. Через INI + перезапуск MCC (заведомо рабочий путь из NOTES §19).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * 48V — фантомное питание. Сейчас он ВКЛЮЧЁН (остался после опыта).
 * Значит цель — ВЫКЛЮЧИТЬ его и убедиться, что получилось.
 *
 * Запуск: node src/tools/prove-48v-write.js
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
  PP_BULK_BEGIN,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini`;
const BACKUP = 'research/live-ini-48v-backup.ini';

const TAG = '11:19';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 13000) {
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
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lk = Date.now(); }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }
  return out;
}

async function writePlain(tt, pp, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(tt, pp, value);
  await sleep(1200);
  try { h.close(); } catch { /* ok */ }
}

async function writeBracket(tt, pp, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(60);
  send(tt, pp, value);
  await sleep(60);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(120);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(1200);
  try { h.close(); } catch { /* ok */ }
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 30000 }).trim();
  } catch { return ''; }
};

function iniSet48v(in1, in2) {
  const lines = readFileSync(INI, 'utf8').split(/\r?\n/);
  let cur = null;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) { cur = m[1]; continue; }
    if (!cur || !cur.startsWith('Input_')) continue;
    if (!t.startsWith('48V=')) continue;
    if (cur === 'Input_IN1') { lines[i] = `48V=${in1}`; n += 1; }
    if (cur === 'Input_IN2') { lines[i] = `48V=${in2}`; n += 1; }
  }
  if (n) writeFileSync(INI, lines.join('\n'), 'utf8');
  return n;
}

async function main() {
  if (!existsSync(BACKUP)) {
    copyFileSync(INI, BACKUP);
    console.log(`бэкап INI: ${BACKUP}`);
  }

  const s0 = await snap();
  const start = s0.get(TAG);
  console.log(`0x${TAG} сейчас = ${start}`);
  const target = start === 1 ? 0 : 1;
  console.log(`цель: ${target}\n`);

  // --- A. одиночный кадр ---
  console.log('A. одиночный кадр…');
  await writePlain(0x11, 0x19, target);
  await sleep(1500);
  let s = await snap();
  const a = s.get(TAG);
  console.log(`   0x${TAG}: ${start} -> ${target} -> ${a}  ${a === target ? 'ПРИНЯТО' : 'нет'}`);

  if (a === target) {
    console.log('\nВЫВОД: 48V пишется одиночным кадром.');
    return;
  }

  // --- B. в брекете ---
  console.log('\nB. в брекете 0x11:0x20…');
  await writeBracket(0x11, 0x19, target);
  await sleep(1500);
  s = await snap();
  const b = s.get(TAG);
  console.log(`   0x${TAG}: ${start} -> ${target} -> ${b}  ${b === target ? 'ПРИНЯТО' : 'нет'}`);

  if (b === target) {
    console.log('\nВЫВОД: 48V пишется в брекете.');
    return;
  }

  // --- C. через INI + перезапуск MCC ---
  console.log('\nC. через INI + перезапуск MCC…');
  const n = iniSet48v(target, 0);
  console.log(`   записано ключей 48V: ${n}`);

  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(22000);

  // читаем, пока MCC работает (чтение параллельно)
  const during = await snap();
  console.log(`   во время работы MCC: 0x${TAG} = ${during.get(TAG)}`);

  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(4000);

  const s3 = await snap();
  const c = s3.get(TAG);
  console.log(`   после закрытия MCC: 0x${TAG} = ${c}  ${c === target ? 'ПРИМЕНЕНО' : 'нет'}`);

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  if (c === target) {
    console.log('48V пишется ТОЛЬКО через INI + перезапуск MCC.');
    console.log('Читается через HID (0x11:0x19), пишется через файл.');
  } else {
    console.log('Не сработал ни один способ. 48V осталось =', c);
    console.log('Верни INI из бэкапа:', BACKUP);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
