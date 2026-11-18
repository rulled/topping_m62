/**
 * ФИНАЛЬНАЯ ПРОВЕРКА: применяется ли запись статических параметров.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * - Запись 0x91:01 = 1 (включение полосы EQ) ПРИМЕНИЛАСЬ: свежий дамп
 *   показывает 91:01 = 1, хотя в момент записи чтение показывало 0.
 * - Запись громкости 0x21:04 возвращается эхом сразу.
 * - Запись 0x46:02 = -28 не применяется уже 50+ секунд.
 *
 * Похоже, MCC (работающий параллельно) держит свою копию состояния и
 * периодически перезаписывает параметры устройства своими.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * 1. Закрываем MCC, чтобы исключить его влияние.
 * 2. Пишем целевые значения (заодно восстанавливаем EQ-полосу в 0).
 * 3. Ждём 10 с и читаем полным дампом.
 * 4. Оставляем MCC закрытым — пользователь запустит сам.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены, проверяется. Компрессор выключен. Значения исходные
 * из INI: 46:02 = -28, 91:01 = 0. Восстановление, а не изменение.
 *
 * Запуск: node src/tools/apply-and-verify.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function closeMcc() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue"],
      { timeout: 30000, encoding: 'utf8' });
  } catch {
    /* ok */
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
      out.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
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
  console.log('=== 1. закрываем MCC ===');
  closeMcc();
  await sleep(3000);
  console.log('  закрыт');

  console.log('\n=== 2. состояние до правки ===');
  let s = await snapshot();
  const hp = s.get('64:06');
  const otg = s.get('62:06');
  console.log(`  46:02 = ${s.get('46:02')}, 91:01 = ${s.get('91:01')}, HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const comp = readIniSection('Compressor');
  const wantThr = Number(comp.Threshold);

  console.log(`\n=== 3. восстанавливаем: 46:02 -> ${wantThr}, 91:01 -> 0 ===`);
  send(0x46, 0x02, wantThr);
  await sleep(400);
  send(0x91, 0x01, 0);
  await sleep(400);
  console.log('  отправлено');

  console.log('\n=== 4. ждём 10 с ===');
  await sleep(10000);

  const after = await snapshot();
  console.log('\n=== 5. результат ===');
  console.log(`  46:02 = ${after.get('46:02')}  (ждали ${wantThr}) ${after.get('46:02') === wantThr ? 'OK' : 'НЕ ПРИМЕНИЛОСЬ'}`);
  console.log(`  91:01 = ${after.get('91:01')}  (ждали 0) ${after.get('91:01') === 0 ? 'OK' : 'НЕ ПРИМЕНИЛОСЬ'}`);

  console.log('\n=== 6. вывод ===');
  const compOk = after.get('46:02') === wantThr;
  console.log(`  без MCC запись применяется: ${compOk ? 'ДА' : 'НЕТ'}`);
  if (!compOk) {
    console.log('  Значит MCC не мешает. Дело в самом устройстве:');
    console.log('  статические параметры применяются только при определённом');
    console.log('  состоянии (вероятно при save-to-device или перезагрузке).');
  }

  try { h.close(); } catch { /* ok */ }
  console.log('\nMCC оставлен ЗАКРЫТЫМ. Запусти его сам, когда закончим.');
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
