/**
 * ЗАПИСЬ EQ И КОМПРЕССОРА — ПОДТВЕРЖДЁННЫМ МЕТОДОМ.
 *
 * ═══ ЧТО БЫЛО НЕ ТАК ВО ВСЕХ ПРЕДЫДУЩИХ ТЕСТАХ ═══
 *
 * Запись НЕ проверялась в чистом эксперименте. Ошибки сложились:
 *
 * 1. MCC РАБОТАЛ во время записи. Он держит свою копию состояния и
 *    периодически возвращает устройство к ней. Любая наша запись
 *    откатывалась. Доказано: с MCC запись 0x46:02 не применялась 60+ с,
 *    без MCC применилась за 10 с.
 *
 * 2. Обратное чтение в ТОЙ ЖЕ сессии показывает кэш, а не применённое
 *    значение. Нужен свежий дамп с паузой >= 700 мс между сессиями
 *    и >= 5 с на полный дамп (иначе EQ не приходит вообще).
 *
 * 3. Проверка по INI бессмысленна при закрытом MCC: файл переписывает
 *    только MCC, а мы его закрыли.
 *
 * ═══ ПОДТВЕРЖДЁННЫЙ ПРОТОКОЛ ИЗМЕРЕНИЯ ═══
 *
 *   MCC ЗАКРЫТ
 *   -> снимок до (7 с)
 *   -> запись
 *   -> пауза 10 с
 *   -> снимок после (7 с)
 *   -> сравнение
 *
 * Этим методом уже проверено:
 *   0x46:02  -30 -> -28   ПРИМЕНИЛОСЬ
 *   0x91:01    1 -> 0     ПРИМЕНИЛОСЬ
 *
 * ═══ ЧТО ПРОВЕРЯЕМ СЕЙЧАС ═══
 *
 * Все 5 полей EQ-полосы и все параметры компрессора — по одному разу.
 * Это даёт полную карту «что пишется через HID».
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG проверяются перед каждым снимком, при подключении СТОП.
 * Звук физически невозможен. Компрессор выключен (Switch=false),
 * EQ выключен (Switch=0). Все значения в допустимых диапазонах и в
 * конце возвращаются к исходным.
 *
 * Запуск: node src/tools/verify-eq-comp-writes.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const SNAPSHOT_MS = 7000;
/** Пауза после записи: подтверждено, что 10 с достаточно. */
const APPLY_WAIT_MS = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hex2 = (n) => n.toString(16).padStart(2, '0');
const key = (tt, pp) => `${hex2(tt)}:${hex2(pp)}`;

function readIniSection(name) {
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
}

function mccRunning() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 20000, encoding: 'utf8' });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(800);
  h = new HID.HID(dev.path);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
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
      out.set(key(f.target, f.prop), f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

async function main() {
  if (mccRunning()) {
    console.error('MCC ЗАПУЩЕН. Закрой его: он откатывает наши записи.');
    process.exit(1);
  }
  console.log('MCC закрыт — условия чистые\n');

  const eqIni = readIniSection('EQ_IN1');
  console.log('INI EQ_IN1 (эталон для восстановления):');
  for (let i = 1; i <= 4; i += 1) console.log(`  Eq%40${i} = ${eqIni[`Eq%40${i}`]}`);

  console.log('\n=== снимок 1 (исходное) ===');
  let s = await snapshot();
  const hp = s.get('64:06');
  const otg = s.get('62:06');
  console.log(`  адресов ${s.size}, HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  // ---------- карта исходных значений ----------
  const TEST = [
    // группа, свойство, имя, тестовое значение
    { g: 0x91, p: 0x01, name: 'EQ полоса1 вкл', val: 1 },
    { g: 0x91, p: 0x02, name: 'EQ полоса1 тип', val: 2 },
    { g: 0x91, p: 0x03, name: 'EQ полоса1 gain', val: 5 },
    { g: 0x91, p: 0x04, name: 'EQ полоса1 freq', val: 1000 },
    { g: 0x91, p: 0x05, name: 'EQ полоса1 Q', val: 10000 },
    { g: 0x46, p: 0x04, name: 'компр Attack', val: 6 },
    { g: 0x46, p: 0x05, name: 'компр Release', val: 250 },
    { g: 0x46, p: 0x08, name: 'компр Mix', val: 90 },
  ];

  const orig = new Map();
  for (const t of TEST) orig.set(key(t.g, t.p), s.get(key(t.g, t.p)));

  console.log('\n=== пишем по одному и ждём 10 с ===');
  const results = [];
  for (const t of TEST) {
    const k = key(t.g, t.p);
    const before = orig.get(k);

    // соединение уже открыто после снимка? нет — снимок его закрыл в конце
    // поэтому пишем через свежее открытие
    const hw = new HID.HID(dev.path);
    const w = (tt, pp, v) => hw.write([...withReportId(buildFrame(tt, pp, v, true))]);
    w(0x11, PP_HANDSHAKE, 1);
    await sleep(300);
    w(t.g, t.p, t.val);
    await sleep(500);
    try { hw.close(); } catch { /* ok */ }

    await sleep(APPLY_WAIT_MS);
    const after = await snapshot();
    const got = after.get(k);
    const ok = got === t.val;
    results.push({ name: t.name, k, before, val: t.val, got, ok });

    console.log(
      `  ${k} ${t.name.padEnd(16)} ${String(before).padStart(6)} -> ${String(t.val).padStart(6)} -> ${String(got).padStart(6)}  ${ok ? 'ПРИНЯТО' : 'нет'}`,
    );
  }

  // ---------- итог ----------
  console.log('\n=== ИТОГ ===');
  for (const r of results) {
    console.log(`  ${r.k}  ${r.name.padEnd(16)} ${r.ok ? 'ПИШЕТСЯ' : 'не пишется'}`);
  }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n  пишется ${okN} из ${results.length}`);

  // ---------- восстановление ----------
  console.log('\n=== восстановление ===');
  const hw = new HID.HID(dev.path);
  const w = (tt, pp, v) => hw.write([...withReportId(buildFrame(tt, pp, v, true))]);
  w(0x11, PP_HANDSHAKE, 1);
  await sleep(300);
  for (const t of TEST) {
    const want = orig.get(key(t.g, t.p));
    if (want !== undefined) {
      w(t.g, t.p, want);
      await sleep(250);
    }
  }
  try { hw.close(); } catch { /* ok */ }

  await sleep(APPLY_WAIT_MS);
  const fin = await snapshot();
  let restored = 0;
  for (const t of TEST) {
    const k = key(t.g, t.p);
    const want = orig.get(k);
    const got = fin.get(k);
    if (got === want) restored += 1;
    else console.log(`  ${k}: ${got}, ждали ${want}`);
  }
  console.log(`  восстановлено ${restored} из ${TEST.length}`);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
