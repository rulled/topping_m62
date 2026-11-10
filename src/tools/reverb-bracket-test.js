/**
 * РЕВЕРБ: ДВА ОСТАВШИХСЯ ПУТИ.
 *
 * ═══ ЧТО УЖЕ ОПРОВЕРГНУТО ═══
 *
 * Прямая запись 0x44:08/09/0a/0f одиночными кадрами не работает
 * (reverb-write-direct.js: 0 из 4, значение возвращается к прежнему).
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ ═══
 *
 * Путь A: запись в брекете 0x11:0x20 (как микшер).
 *         Микшер без брекета игнорируется — возможно, и реверб тоже.
 *
 * Путь B: правка INI + перезапуск MCC. Не требует HID вообще.
 *         Если A не сработает, этот путь рабочий, но требует
 *         установленного MCC (не запущенного постоянно).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG отключены. ReverbType = Bypass, реверб выключен,
 * поэтому изменение его параметров на звук не влияет.
 * Всё возвращается назад, INI — из бэкапа.
 *
 * Запуск: node src/tools/reverb-bracket-test.js
 */

import HID from 'node-hid';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

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

/** Путь A: запись в брекете. */
async function writeBracket(frames) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(60);
  for (const f of frames) {
    send(f.target, f.prop, f.value);
    await sleep(30);
  }
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(100);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(1200);
  try {
    h.close();
  } catch { /* ok */ }
}

function iniSet(key, value) {
  const text = readFileSync(INI, 'utf8');
  const lines = text.split(/\r?\n/);
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

async function main() {
  console.log('=' * 0);
  console.log('ПУТЬ A: запись 0x44 в брекете 0x11:0x20');
  console.log('='.repeat(60));

  const before = await freshSnapshot();
  console.log('  0x44 до:', [...before.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));

  const v08 = before.get('08');
  const target = v08 === 20 ? 30 : 20;
  console.log(`\n  пишу 0x44:08 = ${target} в брекете…`);
  await writeBracket([{ target: 0x44, prop: 0x08, value: target }]);
  await sleep(1500);

  const after = await freshSnapshot();
  const got = after.get('08');
  const okA = got === target;
  console.log(`  0x44:08: ${v08} -> ${target} -> ${got}  ${okA ? 'ПРИНЯТО' : 'нет'}`);

  if (okA) {
    console.log(`  возвращаю ${v08}…`);
    await writeBracket([{ target: 0x44, prop: 0x08, value: v08 }]);
    await sleep(1200);
    const back = await freshSnapshot();
    console.log(`  откат: ${back.get('08') === v08 ? 'ОК' : 'ПРОВЕРЬ'}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  if (okA) {
    console.log('  Реверб пишется В БРЕКЕТЕ. Добавить это в transport и');
    console.log('  перевести /api/reverb на HID.');
  } else {
    console.log('  Брекет тоже не помогает.');
    console.log('  Значит реверб управляется ТОЛЬКО через INI + MCC.');
    console.log('  Это не «недоделанный бекенд», а свойство устройства:');
    console.log('  параметры реверба читаются из HID, но не пишутся в него.');
    console.log('  Файловый путь остаётся единственным — 9 маршрутов');
    console.log('  требуют установленного MCC, это надо принять и записать.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
