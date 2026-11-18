/**
 * ВОССТАНОВЛЕНИЕ громкости IN1 к эталону из workspace-INI.
 *
 * ═══ ЧТО СЛУЧИЛОСЬ ═══
 *
 * test-basic-write.js при первом запуске прочитал текущую громкость (55),
 * записал тестовое значение (43) и должен был вернуть 55. Он вернул 43.
 *
 * Причина: в скрипте значение восстановления берётся из `curVol`, но при
 * повторных запусках оно перечитывается уже ПОСЛЕ теста — то есть
 * восстанавливается к тестовому значению, а не к исходному.
 *
 * Эталон — workspace-INI `[Input_IN1] GAIN`. Читаем оттуда.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Громкость — ВХОД, не выход. HP/OTG отключены.
 *
 * Запуск: node src/tools/restore-in1-gain.js
 */

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function iniGain() {
  const txt = readFileSync(INI, 'utf8');
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) {
      cur = t.slice(1, -1);
      continue;
    }
    if (cur === 'Input_IN1' && t.startsWith('GAIN=')) {
      return Number(t.slice(5).trim());
    }
  }
  return null;
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

async function main() {
  const target = iniGain();
  console.log(`эталон из INI: Input_IN1.GAIN = ${target}`);
  if (target === null || Number.isNaN(target)) {
    console.error('не смог прочитать GAIN из INI');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  // читаем текущее
  let current = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    let buf;
    try {
      buf = h.readTimeout(20);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    if (isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    if (f.target === 0x21 && f.prop === 0x04) current = f.value;
  }
  console.log(`текущее в устройстве: 0x21:04 = ${current}`);

  const hp = null; // проверим отдельно
  if (current === target) {
    console.log('уже совпадает, ничего не делаем');
    try { h.close(); } catch { /* ok */ }
    return;
  }

  send(0x21, 0x04, target);
  await sleep(1200);
  console.log(`записали ${target}`);

  try { h.close(); } catch { /* ok */ }
  await sleep(900);

  // проверяем
  const h2 = new HID.HID(dev.path);
  const s2 = (tt, pp, v) => h2.write([...withReportId(buildFrame(tt, pp, v, true))]);
  s2(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  s2(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  s2(0x11, PP_ANNOUNCE, 1);

  let after = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 6000) {
    let buf;
    try {
      buf = h2.readTimeout(20);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    if (isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    if (f.target === 0x21 && f.prop === 0x04) after = f.value;
  }
  try { h2.close(); } catch { /* ok */ }

  console.log(`после записи: 0x21:04 = ${after}  ${after === target ? 'ВОССТАНОВЛЕНО' : 'НЕ СОВПАЛО'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
