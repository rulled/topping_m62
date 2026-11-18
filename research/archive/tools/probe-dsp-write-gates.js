/**
 * ПОЧЕМУ ГРОМКОСТЬ ПИШЕТСЯ, А КОМПРЕССОР И EQ — НЕТ.
 *
 * ═══ УСТАНОВЛЕННЫЕ ФАКТЫ ═══
 *
 * test-basic-write.js: запись 0x21:04 (Mic-1 volume) 55 -> 43 ПРИНЯТА,
 * и обратное чтение через полный дамп это ПОДТВЕРЖДАЕТ.
 * Значит HID-канал записи исправен, а обратное чтение достоверно.
 *
 * При этом 0x46:02 (Threshold) и 0x91:04 (EQ freq) запись НЕ принимают.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 * H1 (bulk): DSP-параметры пишутся только при открытом bulk-режиме
 *    0x11:0x20 = 1. Громкость — «живой» параметр, ей bulk не нужен.
 * H2 (save): запись проходит, но требует 0x11:0x05 = 1 (save-to-device),
 *    чтобы примениться.
 * H3 (switch): компрессор выключен (Switch=false), поэтому его параметры
 *    игнорируются. Включать НЕ будем — это изменит звук.
 * H4 (семейство): 0x46/0x91 — только чтение через HID, запись идёт
 *    каналом UI/файла.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * Пишем одно и то же значение компрессора тремя способами и после каждого
 * перечитываем полным дампом:
 *   A) просто запись
 *   B) bulk-режим открыт -> запись -> bulk закрыт
 *   C) запись -> save-to-device
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены, проверяется до записи. Компрессор ВЫКЛЮЧЕН — правка
 * инертна. Threshold -30 в допустимом диапазоне -36..0. В конце вернём -28.
 *
 * Запуск: node src/tools/probe-dsp-write-gates.js
 */

import HID from 'node-hid';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
  PP_BULK_BEGIN,
  PP_SAVE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const SNAPSHOT_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const open = () => {
  h = new HID.HID(dev.path);
};
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/**
 * Полный снимок: пауза >= 700 мс между сессиями обязательна,
 * иначе устройство не отдаёт статический дамп.
 */
async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(800);
  open();
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

/** Запись на уже открытом соединении. */
async function writeLive(tt, pp, v) {
  send(tt, pp, v);
  await sleep(300);
}

const KEY = '46:02';
const TEST_VALUE = -30;

async function main() {
  console.log('снимок 0 (исходное)…');
  const s0 = await snapshot();
  const orig = s0.get(KEY);
  console.log(`  ${KEY} = ${orig}, HP=${s0.get('64:06')} OTG=${s0.get('62:06')}`);

  if (s0.get('64:06') !== 0 || s0.get('62:06') !== 0) {
    console.log('  СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const attempts = [];

  // ---------- A: простая запись ----------
  console.log('\nA) простая запись');
  await snapshot(); // открывает соединение
  await writeLive(0x46, 0x02, TEST_VALUE);
  await sleep(1200);
  let s = await snapshot();
  attempts.push({ name: 'A простая запись', got: s.get(KEY) });
  console.log(`   -> ${KEY} = ${s.get(KEY)}  ${s.get(KEY) === TEST_VALUE ? 'ПРИНЯТО' : 'не принято'}`);

  // ---------- B: bulk-режим ----------
  console.log('\nB) bulk-режим: открыть -> записать -> закрыть');
  await snapshot();
  await writeLive(0x11, PP_BULK_BEGIN, 1);
  await sleep(500);
  await writeLive(0x46, 0x02, TEST_VALUE);
  await sleep(800);
  await writeLive(0x11, PP_BULK_BEGIN, 0);
  await sleep(800);
  s = await snapshot();
  attempts.push({ name: 'B bulk', got: s.get(KEY) });
  console.log(`   -> ${KEY} = ${s.get(KEY)}  ${s.get(KEY) === TEST_VALUE ? 'ПРИНЯТО' : 'не принято'}`);

  // ---------- C: запись + save ----------
  console.log('\nC) запись -> save-to-device');
  await snapshot();
  await writeLive(0x46, 0x02, TEST_VALUE);
  await sleep(500);
  await writeLive(0x11, PP_SAVE, 1);
  await sleep(1500);
  s = await snapshot();
  attempts.push({ name: 'C save', got: s.get(KEY) });
  console.log(`   -> ${KEY} = ${s.get(KEY)}  ${s.get(KEY) === TEST_VALUE ? 'ПРИНЯТО' : 'не принято'}`);

  // ---------- D: bulk + save ----------
  console.log('\nD) bulk открыть -> запись -> save -> bulk закрыть');
  await snapshot();
  await writeLive(0x11, PP_BULK_BEGIN, 1);
  await sleep(500);
  await writeLive(0x46, 0x02, TEST_VALUE);
  await sleep(500);
  await writeLive(0x11, PP_SAVE, 1);
  await sleep(1000);
  await writeLive(0x11, PP_BULK_BEGIN, 0);
  await sleep(800);
  s = await snapshot();
  attempts.push({ name: 'D bulk+save', got: s.get(KEY) });
  console.log(`   -> ${KEY} = ${s.get(KEY)}  ${s.get(KEY) === TEST_VALUE ? 'ПРИНЯТО' : 'не принято'}`);

  // ---------- итог ----------
  console.log('\n=== итог по способам ===');
  for (const a of attempts) {
    console.log(`  ${a.name.padEnd(20)} -> ${a.got}  ${a.got === TEST_VALUE ? 'ПРИНЯТО' : 'нет'}`);
  }
  const anyOk = attempts.some((a) => a.got === TEST_VALUE);
  if (!anyOk) {
    console.log('\n  Ни один способ не сработал.');
    console.log('  Вывод: 0x46:02 через HID только читается. Запись — канал UI/файла.');
  }

  // ---------- восстановление ----------
  if (orig !== undefined) {
    console.log(`\nвосстановление ${KEY} -> ${orig}`);
    await snapshot();
    await writeLive(0x46, 0x02, orig);
    await sleep(800);
    const fin = await snapshot();
    console.log(`  ${KEY} = ${fin.get(KEY)} ${fin.get(KEY) === orig ? 'ok' : '(не вернулось)'}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
