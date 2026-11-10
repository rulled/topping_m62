/**
 * МАСКА DUCKING: какие биты каким входам соответствуют.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 *   0x43:0x05  маска входов, младший байт
 *   0x43:0x06  маска входов, старший байт
 *
 * Из захватов: значения [224, 255] для 0x05 и [255] для 0x06.
 * В INI у ducking есть список вида:
 *
 *   [Ducking]
 *   IN1AUX=true        IN2AUX=true
 *   IN1BT=true         IN2BT=true
 *   IN1OTGIN=true      IN2OTGIN=true
 *   IN1Playback1_2=true  IN2Playback1_2=true
 *   ... и так далее
 *
 * То есть маска говорит, на какие источники действует ducking,
 * отдельно для IN1 и IN2.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Если 0x43:05 = 255 (все биты) и 0x43:06 = 255 — ducking включён
 * на всех. Включаем ВСЁ в INI, потом по одному выключаем и смотрим,
 * какой бит меняется.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Ducking сам по себе не меняет звук, пока не включён его Switch
 * (0x43:07) и не приглушается музыка. Проверяем безопасность.
 *
 * Запуск: node src/tools/prove-ducking-mask.js
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
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function fullSnap(min = 100, attempts = 3) {
  let best = new Map();
  for (let i = 1; i <= attempts; i++) {
    const dev = findDev();
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
    while (Date.now() - t0 < 15000) {
      for (let j = 0; j < 128; j++) {
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
    if (out.size > best.size) best = out;
    if (out.size >= min) return best;
    await sleep(2000);
  }
  return best;
}

async function writeOne(tt, pp, value) {
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

function bits(v) {
  if (v === null || v === undefined) return '—';
  const out = [];
  for (let i = 0; i < 8; i += 1) if (v & (1 << i)) out.push(i);
  return out.length ? out.join(',') : '(нет)';
}

async function main() {
  const base = await fullSnap();
  console.log(`базовый снимок: ${base.size} тегов`);

  const hp = base.get('64:06');
  const otg = base.get('62:06');
  console.log(`наушники=${hp}  OTG=${otg}\n`);

  const m0 = base.get('43:05');
  const m1 = base.get('43:06');
  console.log('текущая маска ducking:');
  console.log(`  0x43:05 = ${m0}  биты: ${bits(m0)}`);
  console.log(`  0x43:06 = ${m1}  биты: ${bits(m1)}`);
  console.log('');

  /**
   * Проверяем: пишется ли маска вообще, и читается ли обратно.
   *
   * ВАЖНО: ducking не читается как состояние параметров, но маска
   * может приходить. Проверим.
   */
  const tests = [
    { value: 0xFF, label: 'все биты' },
    { value: 0x00, label: 'ничего' },
    { value: 0x0F, label: 'младшие 4' },
    { value: 0xF0, label: 'старшие 4' },
  ];

  console.log('='.repeat(60));
  console.log('ПИШУ РАЗНЫЕ МАСКИ И СМОТРЮ, ЧТО ПРИХОДИТ ОБРАТНО');
  console.log('='.repeat(60));

  for (const t of tests) {
    console.log(`\n0x43:05 = ${t.value} (0x${t.value.toString(16)}, ${t.label})`);
    await writeOne(0x43, 0x05, t.value);
    await sleep(1000);

    const after = await fullSnap();
    const got = after.get('43:05');
    console.log(`  стало: ${got}  биты: ${bits(got)}  ${got === t.value ? 'ПРИНЯТО' : 'не читается обратно'}`);
  }

  // вернуть исходное
  if (m0 !== undefined) {
    console.log(`\nвозвращаю 0x43:05 = ${m0}`);
    await writeOne(0x43, 0x05, m0);
  }
  if (m1 !== undefined) {
    console.log(`возвращаю 0x43:06 = ${m1}`);
    await writeOne(0x43, 0x06, m1);
  }

  await sleep(1500);
  const fin = await fullSnap();

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  console.log(`  0x43:05: ${m0} -> ${fin.get('43:05')}`);
  console.log(`  0x43:06: ${m1} -> ${fin.get('43:06')}`);
  console.log(`
  Если значения не читаются обратно — это как loopback и ducking:
  только запись. Тогда соответствие битов входам можно установить
  только захватом (что MCC шлёт при разных настройках в INI).

  Если читаются — видно, что запись принимается, и можно перебирать
  биты, сверяя с INI.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
