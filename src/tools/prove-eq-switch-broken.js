/**
 * РЕАЛЬНО ЛИ РАБОТАЕТ ПЕРЕКЛЮЧАТЕЛЬ EQ?
 *
 * ═══ ПОДОЗРЕНИЕ ═══
 *
 * `POST /api/eq/switch` пишет 0x9b:0x0f / 0x9b:0x10. Но доказано
 * (prove-9b-readonly.js), что ВСЁ семейство 0x9b НЕ принимает запись:
 *
 *   0x9b:0f  1 -> пишу 0 -> читается 1   НЕ принято
 *   0x9b:10  0 -> пишу 1 -> читается 0   НЕ принято
 *   0x9b:12  0 -> пишу 1 -> читается 0   НЕ принято
 *   0x9b:13  0 -> пишу 1 -> читается 0   НЕ принято
 *
 * При этом маршрут отвечает ok:true. Причина: `transport.writeFrames`
 * обновляет ЛОКАЛЬНЫЙ КЕШ оптимистично (это делалось специально,
 * чтобы не читать «до» после записи). В итоге последующий
 * `transport.snapshot()` показывает наше собственное значение,
 * а не состояние устройства. Получается ложное «работает».
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Читает реальное состояние в НОВОЙ HID-сессии (кеш не участвует).
 * 2. Пишет 0x9b:0f = противоположное.
 * 3. Снова читает в НОВОЙ сессии — устройство отдаёт правду.
 * 4. Сравнивает с тем, что показывает наш кеш.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся, mute проверяется длинным снимком.
 *
 * Запуск: node src/tools/prove-eq-switch-broken.js
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

/** НОВАЯ сессия = правда от устройства, без нашего кеша. */
async function truth(ms = 10000) {
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
  while (Date.now() - t0 < ms) {
    for (let j = 0; j < 128; j++) {
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
  } catch {
    /* ok */
  }
  return out;
}

async function write(frames) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(400);
  }
  await sleep(900);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(64));
  console.log('ПЕРЕКЛЮЧАТЕЛЬ EQ: РАБОТАЕТ ИЛИ ТОЛЬКО ОТВЕЧАЕТ ok?');
  console.log('='.repeat(64));

  const s0 = await truth();
  const jack = s0.get('64:06');
  const mute0 = s0.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  let restoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    await write([[0x64, 0x04, 1]]);
    const chk = await truth();
    if (chk.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    restoreMute = true;
    console.log('  заглушено и подтверждено');
  }

  const before = s0.get('9b:0f');
  console.log(`\nПРАВДА от устройства: 0x9b:0f = ${before}`);

  const target = before === 1 ? 0 : 1;
  console.log(`пишу 0x9b:0f = ${target} (напрямую в HID)…`);
  await write([[0x9b, 0x0f, target]]);

  const after = await truth();
  const got = after.get('9b:0f');
  const worked = got === target;

  console.log(`\nПРАВДА после записи: 0x9b:0f = ${got}`);
  console.log(`  ожидали ${target} -> ${worked ? 'ПРИМЕНИЛОСЬ' : 'НЕ ПРИМЕНИЛОСЬ'}`);

  // что показал бы наш кеш?
  console.log('\n' + '-'.repeat(64));
  console.log('А ТЕПЕРЬ ЧЕРЕЗ БЭКЕНД (кеш + запись)');
  console.log('-'.repeat(64));
  try {
    const r1 = await fetch('http://127.0.0.1:8894/api/eq/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'IN1', enabled: target === 1 }),
    });
    const j1 = await r1.json();
    console.log(`  бекенд ответил: ok=${j1.ok} before=${j1.before} changed=${j1.changed}`);

    const r2 = await fetch('http://127.0.0.1:8894/api/eq');
    const j2 = await r2.json();
    console.log(`  бекенд думает: raw=${j2.switches?.in1?.raw} enabled=${j2.switches?.in1?.enabled}`);

    const real = await truth();
    console.log(`  устройство на самом деле: 0x9b:0f = ${real.get('9b:0f')}`);

    if (j2.switches?.in1?.raw !== real.get('9b:0f')) {
      console.log('\n  >>> РАСХОЖДЕНИЕ: бекенд показывает не то, что в устройстве!');
      console.log('  >>> это оптимистичный кеш, а не реальное состояние');
    }
  } catch (e) {
    console.log(`  бекенд недоступен: ${e.message}`);
  }

  // вернуть как было
  await write([[0x9b, 0x0f, before ?? 0]]);
  if (restoreMute) await write([[0x64, 0x04, mute0 ?? 0]]);

  console.log('\n' + '='.repeat(64));
  console.log('ИТОГ');
  console.log('='.repeat(64));
  if (!worked) {
    console.log('  Переключатель EQ ЧЕРЕЗ 0x9b НЕ РАБОТАЕТ.');
    console.log('  Маршрут /api/eq/switch отвечает ok:true, но устройство');
    console.log('  значение не принимает. Нужен другой адрес для вкл/выкл EQ.');
  } else {
    console.log('  Переключатель работает — прежний вывод о read-only неверен.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
