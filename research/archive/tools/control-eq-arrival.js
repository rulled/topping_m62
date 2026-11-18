/**
 * КОНТРОЛЬНЫЙ ОПЫТ: приходит ли 0x91 сам по себе, БЕЗ записи?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Предыдущий тест (test-eq-input-hid-write.js) написал 0x91:03 = 3
 * и во втором снимке тега НЕ УВИДЕЛ. Но по правилу §130 «undefined
 * после записи = не увидели, а не отказано». Значит вывод «не пишется»
 * делать нельзя, пока не проверено, приходит ли тег вообще.
 *
 * Здесь два снимка ПОДРЯД, БЕЗ ВСЯКОЙ ЗАПИСИ. Если 0x91 не появляется
 * и во втором — виноват метод измерения (или MCC держит поток),
 * а не устройство.
 *
 * Запуск: node src/tools/control-eq-arrival.js
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

async function main() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 iface 4 не найден');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  const snapshot = async (label, ms) => {
    const out = new Map();
    const t0 = Date.now();
    let lastKeep = 0;
    let lastAnn = 0;
    let firstEqAt = null;
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
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
        if (firstEqAt === null && f.target >= 0x91 && f.target <= 0x94) {
          firstEqAt = ((Date.now() - t0) / 1000).toFixed(1);
        }
      }
      if (Date.now() - lastKeep >= 2000) {
        send(0x11, PP_SUBSCRIBE, 1);
        lastKeep = Date.now();
      }
      if (Date.now() - lastAnn >= 6000) {
        send(0x11, PP_ANNOUNCE, 1);
        lastAnn = Date.now();
      }
      await sleep(8);
    }
    const eqKeys = [...out.keys()].filter((k) => /^9[1-4]:/.test(k));
    console.log(`  ${label.padEnd(10)} тегов=${String(out.size).padStart(3)}`
      + `  EQ-входов=${String(eqKeys.length).padStart(2)}`
      + `  0x91:03=${out.get('91:03') ?? '—'}`
      + `  первый EQ на ${firstEqAt ?? '—'} с`);
    return out;
  };

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);

  console.log('ДВА СНИМКА ПОДРЯД, ЗАПИСИ НЕТ:\n');
  const a = await snapshot('снимок 1', 26000);
  const b = await snapshot('снимок 2', 26000);

  const eqA = [...a.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  const eqB = [...b.keys()].filter((k) => /^9[1-4]:/.test(k)).length;

  h.close();

  console.log('\n' + '='.repeat(62));
  console.log('ВЫВОД');
  console.log('='.repeat(62));
  if (eqA > 0 && eqB > 0) {
    console.log('  EQ-блоки приходят в ОБОИХ снимках — метод годен.');
    console.log('  Значит в прошлом тесте тег пропал ИЗ-ЗА записи.');
  } else if (eqA > 0 && eqB === 0) {
    console.log('  В первом снимке EQ есть, во втором НЕТ — хотя записи не было!');
    console.log('  Это дефект МЕТОДА, а не отказ устройства.');
    console.log('  Скорее всего MCC держит HID-поток (он сейчас в трее).');
    console.log('  Вывод «EQ не пишется через HID» НЕДОКАЗАН.');
  } else {
    console.log('  EQ-блоки не пришли ни разу.');
    console.log('  Устройство не в Prof-режиме, либо MCC перехватывает поток.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
