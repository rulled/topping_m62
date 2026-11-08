/**
 * Решающий тест: что из «файлового» ПИШЕТСЯ через HID после Load preset.
 *
 * ЗАЧЕМ: определяет границу «чистый веб (WebHID) / нужен бекенд».
 *
 * БЕЗОПАСНОСТЬ (проверено на момент запуска):
 *   - EQ_IN1.Switch = 0, EQ_IN2.Switch = 0  -> полосы инертны
 *   - DuckingSwitch = 0                     -> ducking инертен
 *   - выходы (62:06, 64:06) = 0             -> звук физически невозможен
 * Скрипт сам перепроверяет эти условия и отказывается работать иначе.
 *
 * Запуск: node src/tools/probe-hid-write-matrix.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

/**
 * Что проверяем. Берём только теги, которые после Load preset
 * РЕАЛЬНО приходят, иначе проверка записи бессмысленна.
 */
const CASES = [
  { tt: 0x91, pp: 0x04, label: 'EQ_IN1 band1 freq' },
  { tt: 0x91, pp: 0x06, label: 'EQ_IN1 band1 gain' },
  { tt: 0x46, pp: 0x04, label: 'Compressor Attack' },
  { tt: 0x44, pp: 0x08, label: 'Reverb dryWet' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function collect(ms = 5000) {
  const out = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let buf;
    try {
      buf = h.readTimeout(30);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) f = bytes.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    // ключ в hex — так же, как в CASES
    const key = `0x${f[5].toString(16)}:0x${f[6].toString(16).padStart(2, '0')}`;
    out.set(key, f.readInt32BE(7));
  }
  return out;
}

/** Единый формат ключа: 0xtt:0xpp. */
const keyOf = (c) => `0x${c.tt.toString(16)}:0x${c.pp.toString(16).padStart(2, '0')}`;

const loadPreset = async () => {
  send(0x11, 0x0e, 1);
  return collect(9000);
};

/**
 * Полное состояние = обычный ANNOUNCE (даёт джеки, настройки)
 * + Load preset (даёт компрессор, EQ-полосы).
 * Джеки приходят только в ANNOUNCE, поэтому сливаем обе фазы.
 */
const fullState = async () => {
  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const announcePhase = await collect(7000);
  send(0x11, 0x0e, 1);
  const presetPhase = await collect(9000);
  return new Map([...announcePhase, ...presetPhase]);
};

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  const state = await fullState();

  // --- проверка безопасности ---
  const hpJack = state.get('0x64:0x06');
  const otgJack = state.get('0x62:0x06');
  const eq1 = state.get('0x9b:0x0f');
  const eq2 = state.get('0x9b:0x10');
  const duck = state.get('0x43:0x07');
  const compSw = state.get('0x46:0x01');

  console.log('=== безопасность ===');
  console.log(`  выходы: HP=${hpJack ?? '—'}  OTG=${otgJack ?? '—'}`);
  console.log(`  EQ_IN1.Switch=${eq1 ?? '—'}  EQ_IN2.Switch=${eq2 ?? '—'}`);
  console.log(`  DuckingSwitch=${duck ?? '—'}  Compressor.Switch=${compSw ?? '—'}`);

  const outputsOff = hpJack === 0 && otgJack === 0;
  const eqOff = eq1 === 0 && eq2 === 0;
  const duckOff = duck === 0 || duck === undefined;
  const compOff = compSw === 0;

  if (!outputsOff) {
    console.log('\nСТОП: выход подключён — звук возможен. Не рискую.');
    clearInterval(keepalive); h.close(); return;
  }
  if (!eqOff || !duckOff || !compOff) {
    console.log('\nСТОП: не все цели инертны.');
    clearInterval(keepalive); h.close(); return;
  }
  console.log('  -> все цели инертны, звук невозможен\n');

  // --- какие теги приходят ---
  console.log('=== приходящие теги интересующих блоков ===');
  for (const c of CASES) {
    const k = keyOf(c);
    console.log(`  ${c.label.padEnd(22)} ${k.padEnd(8)} = ${state.has(k) ? state.get(k) : 'НЕ приходит'}`);
  }

  if (!DO_WRITE) {
    console.log('\n(режим чтения; добавь --write)');
    clearInterval(keepalive); h.close(); return;
  }

  // --- проверка записи ---
  console.log('\n=== проверка записи ===');
  const results = [];
  for (const c of CASES) {
    const k = keyOf(c);
    if (!state.has(k)) {
      results.push({ ...c, verdict: 'тег не приходит', accepted: false });
      continue;
    }
    const orig = state.get(k);
    const target = orig === 5 ? 7 : 5;
    console.log(`\n${c.label}: ${orig} -> ${target}`);
    send(c.tt, c.pp, target);
    await sleep(800);
    const after = await fullState();
    const got = after.get(k);
    const accepted = got === target;
    console.log(`  после Load preset: ${got}  -> ${accepted ? 'ПРИНЯТО' : 'НЕ принято'}`);
    results.push({ ...c, verdict: `${orig}->${target}: ${got}`, accepted });

    send(c.tt, c.pp, orig);
    await sleep(600);
  }

  // Финальный откат + проверка
  await loadPreset();
  console.log('\n=== ИТОГ ===');
  for (const r of results) {
    console.log(`  ${r.label.padEnd(22)} ${r.accepted ? 'ПИШЕТСЯ' : 'НЕ пишется'}   (${r.verdict})`);
  }
  const writable = results.filter((r) => r.accepted).length;
  console.log(`\n  пишется через HID: ${writable} из ${results.length}`);

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});


