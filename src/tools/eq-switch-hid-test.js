/**
 * ОБЩИЙ ВКЛЮЧАТЕЛЬ EQ (0x9b:0x0f / 0x9b:0x10) — пишется ли через HID.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `/api/eq/switch` включает EQ входа целиком. Сейчас он ходит через
 * `setEqSwitch()` -> `ensureMcc()` -> TogglePattern кнопки в окне MCC.
 *
 * Теги `0x9b:0x0f` (IN1) и `0x9b:0x10` (IN2) читаются из HID
 * (`src/tags.js`). Значит, возможно, и пишутся.
 *
 * ═══ ПРАВИЛА ═══
 *
 *   - MCC закрыт;
 *   - снимок «до» и «после» — РАЗНЫЕ сессии (EQ приходит только
 *     на первый announce сессии, проверено 2026-11-10);
 *   - «принято» только если видно в новой сессии.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется вкл/выкл EQ входа IN1 и возвращается. Наушники и OTG
 * должны быть отключены. Полосы EQ выключены (все 0x91:01 = 0),
 * так что сам EQ на звук не влияет.
 *
 * Запуск: node src/tools/eq-switch-hid-test.js
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

async function freshSnapshot(ms = 18000) {
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
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
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
  try {
    h.close();
  } catch { /* ok */ }
}

async function main() {
  console.log('Снимок «до»…');
  const before = await freshSnapshot();

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }

  const orig = before.get('9b:0f');
  console.log(`  0x9b:0x0f (EQ IN1 вкл) = ${orig ?? 'тег не пришёл'}`);
  const bandsOn = [1, 2, 3, 4].map((b) => before.get(`91:0${b === 1 ? 1 : b === 2 ? 6 : b === 3 ? 1 : 6}`));
  console.log(`  (полосы: ${bandsOn.join(', ')})\n`);

  if (orig === undefined) {
    console.log('Тег не пришёл — проверять нечего.');
    process.exit(3);
  }

  const target = orig === 1 ? 0 : 1;
  console.log(`Пишу 0x9b:0f = ${target} …`);
  await writeOne(0x9b, 0x0f, target);
  await sleep(1500);

  const after = await freshSnapshot();
  const got = after.get('9b:0f');
  const ok = got === target;

  console.log(`  0x9b:0x0f: ${orig} -> ${target} -> ${got ?? '—'}  ${ok ? 'ПРИНЯТО' : 'нет'}`);

  if (ok) {
    console.log(`\nВозвращаю ${orig} …`);
    await writeOne(0x9b, 0x0f, orig);
    await sleep(1200);
    const back = await freshSnapshot();
    console.log(`  откат: ${back.get('9b:0f') === orig ? 'ОК' : 'ПРОВЕРЬ'}`);
  }

  console.log('\n' + '='.repeat(56));
  if (ok) {
    console.log('Общий включатель EQ пишется через HID — UI не нужен.');
  } else {
    console.log('НЕ пишется через HID. Оставить UI-путь для /api/eq/switch.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
