/**
 * ПОЛНЫЙ ДАМП РЕЖИМА — сохранить в JSON для сравнения.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Устройство ведёт себя по-разному в трёх режимах (Mobile/Live/Prof):
 * набор блоков меняется. Чтобы понять, где живут те или иные теги,
 * надо снять полный дамп в каждом режиме и сравнить.
 *
 * Блоки 0xa1..0xaa не появились ни в Live, ни в Mobile. Скорее всего
 * они в Prof (там есть EQ наушников на 6 полос, которого нет в других).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Открывает сессию, слушает полный дамп (7 с), сохраняет все адреса
 * и значения в research/mode-<имя>.json.
 *
 * Запуск: node src/tools/dump-mode.js <имя>
 *        node src/tools/dump-mode.js mobile
 */

import { writeFileSync } from 'node:fs';
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
const SNAPSHOT_MS = 7500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const name = process.argv[2] ?? 'unknown';
const outFile = path.join('research', `mode-${name}.json`);

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
const key = (tt, pp) => `${hex2(tt)}:${hex2(pp)}`;

async function main() {
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const state = new Map();
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
      state.set(key(f.target, f.prop), f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  // по семействам
  const families = {};
  for (const k of state.keys()) {
    const tt = k.slice(0, 2);
    families[tt] = (families[tt] || 0) + 1;
  }

  const dump = {
    mode: name,
    capturedAt: new Date().toISOString(),
    total: state.size,
    families,
    tags: Object.fromEntries([...state.entries()].sort()),
  };

  writeFileSync(outFile, JSON.stringify(dump, null, 2), 'utf8');

  console.log(`режим: ${name}`);
  console.log(`адресов: ${state.size}`);
  console.log(`файл: ${outFile}`);
  console.log('\nпо семействам:');
  for (const tt of Object.keys(families).sort()) {
    console.log(`  0x${tt}: ${families[tt]}`);
  }

  // что искали
  const probes = {
    'EQ 0xa1..0xaa': (k) => /^a[1-9a]:/.test(k),
    'микшер 0x31..0x3c': (k) => /^3[1-8b-c]:/.test(k) && !k.endsWith(':15'),
    'loopback 0x51..0x58': (k) => /^5[1-8]:/.test(k),
    'ducking 0x43': (k) => k.startsWith('43:'),
    'эффекты 0x44': (k) => k.startsWith('44:'),
  };
  console.log('\nцелевые блоки:');
  for (const [label, fn] of Object.entries(probes)) {
    const hits = [...state.keys()].filter(fn).sort();
    console.log(`  ${label}: ${hits.length ? `${hits.length} (${hits.slice(0, 6).join(' ')})` : 'нет'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
