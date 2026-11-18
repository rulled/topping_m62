/**
 * Только запись микшера — без захвата и без MCC.
 *
 * Вызывается из verify-write.ps1, когда захват уже идёт.
 *
 * Пишет фиксированную матрицу через bulk push нашим кодом
 * (buildMixerPacket из src/mixer-tags.js), в точном порядке MCC.
 *
 * ═══ ЧТО ПИШЕМ ═══
 *
 *   Mix B: PB12 = -25 дБ, остальные mute
 *   Все остальные шины: mute
 *
 * Значение -25 выбрано так, чтобы его легко отличить от эталона
 * (в эталоне PB12 стоит на -15).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG проверяются перед записью, при подключении СТОП.
 * Все значения отрицательные (тише unity).
 *
 * Запуск: node src/tools/write-mixer-only.js
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
} from '../protocol.js';
import { buildMixerPacket } from '../mixer-tags.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Что пишем: Mix B, PB12 = -25 дБ. Остальное mute. */
const TEST_DB = -25;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

async function main() {
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  // проверка безопасности
  let hp = null;
  let otg = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    let buf;
    try {
      buf = h.readTimeout(20);
    } catch {
      break;
    }
    if (!buf || !buf.length || isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    if (f.target === 0x64 && f.prop === 0x06) hp = f.value;
    if (f.target === 0x62 && f.prop === 0x06) otg = f.value;
  }
  console.log(`  HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  // ---------- запись ----------
  console.log(`  пишем Mix B, PB12 = ${TEST_DB} дБ`);

  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(120);

  const packet = buildMixerPacket({ b: { pb12: TEST_DB } });
  for (const frame of packet) {
    send(frame.target, frame.prop, frame.value);
    await sleep(2);
  }

  await sleep(200);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(200);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(800);

  console.log(`  отправлено ${packet.length} кадров, брекет закрыт`);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
