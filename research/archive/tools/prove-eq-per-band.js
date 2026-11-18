/**
 * СУЩЕСТВУЕТ ЛИ ГЛОБАЛЬНЫЙ ВЫКЛЮЧАТЕЛЬ EQ?
 *
 * ═══ ЧТО ПРИВЕЛО К ВОПРОСУ ═══
 *
 * 1. Запись 0x9b:0f = 1 НЕ принимается (проверено, 0 -> 1 -> читаю 0).
 * 2. При нажатии кнопки EQ В САМОМ MCC 0x9b:0f тоже НЕ меняется.
 * 3. Захват eq-switch.pcap: при нажатии кнопки EQ MCC не отправил
 *    НИ ОДНОГО кадра 0x9b и ни одного 0x91..0x94.
 *
 * Вывод-гипотеза: ГЛОБАЛЬНОГО переключателя EQ в протоколе нет.
 * Кнопка EQ в MCC — это, вероятно, только показ/скрытие панели EQ
 * (или состояние UI), а сама обработка включается ПО ПОЛОСАМ:
 * бит enable у каждой полосы (0x91:0x01, 0x91:0x06, ...).
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 *   A. 0x9b:0f = 1          -> ожидаем НЕ принято (уже знаем)
 *   B. 0x91:01 = 1 (band 1) -> ожидаем ПРИНЯТО (NOTES §135.2)
 *   C. 0x91:06 = 1 (band 2) -> ожидаем ПРИНЯТО
 *   D. вернуть всё назад
 *
 * Если B и C принимаются — EQ управляется по полосам, глобальный
 * выключатель не нужен, и /api/eq/switch надо переписать.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся длинным снимком с подтверждением. EQ с gain=0
 * звук не меняет.
 *
 * Запуск: node src/tools/prove-eq-per-band.js
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
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

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
  console.log('='.repeat(66));
  console.log('ЕСТЬ ЛИ ГЛОБАЛЬНЫЙ ВЫКЛЮЧАТЕЛЬ EQ, ИЛИ ТОЛЬКО ПО ПОЛОСАМ?');
  console.log('='.repeat(66));

  const s0 = await truth();
  const jack = s0.get('64:06');
  const mute0 = s0.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  let restoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    await write([[0x64, 0x04, 1]]);
    if ((await truth()).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    restoreMute = true;
    console.log('  заглушено');
  }

  const state = await truth();
  console.log('\nисходное:');
  console.log(`  0x9b:0f  (мин. глобальный EQ IN1) = ${state.get('9b:0f')}`);
  console.log(`  0x91:01  (band1 enable IN1)       = ${state.get('91:01')}`);
  console.log(`  0x91:06  (band2 enable IN1)       = ${state.get('91:06')}`);
  console.log(`  0x93:01  (band1 enable IN2)       = ${state.get('93:01')}`);
  console.log(`  0x91:03  (band1 gain IN1)         = ${state.get('91:03')}`);

  const orig = {
    '9b:0f': state.get('9b:0f'),
    '91:01': state.get('91:01'),
    '91:06': state.get('91:06'),
    '93:01': state.get('93:01'),
  };

  const results = [];

  const trial = async (label, tt, pp, from, to) => {
    console.log(`\n${label}: 0x${hex2(tt)}:0x${hex2(pp)}  ${from} -> пишу ${to}`);
    await write([[tt, pp, to]]);
    const after = await truth();
    const got = after.get(`${hex2(tt)}:${hex2(pp)}`);
    const ok = got === to;
    console.log(`  читается: ${got}   ${ok ? 'ПРИНЯТО' : 'НЕ принято'}`);
    results.push({ label, addr: `0x${hex2(tt)}:0x${hex2(pp)}`, from, to, got, ok });
    if (ok) await write([[tt, pp, from ?? 0]]);
    return ok;
  };

  await trial('A глобальный EQ IN1', 0x9b, 0x0f, orig['9b:0f'], orig['9b:0f'] === 1 ? 0 : 1);
  await trial('B полоса 1 IN1', 0x91, 0x01, orig['91:01'], orig['91:01'] === 1 ? 0 : 1);
  await trial('C полоса 2 IN1', 0x91, 0x06, orig['91:06'], orig['91:06'] === 1 ? 0 : 1);
  await trial('D полоса 1 IN2', 0x93, 0x01, orig['93:01'], orig['93:01'] === 1 ? 0 : 1);

  if (restoreMute) await write([[0x64, 0x04, mute0 ?? 0]]);

  console.log('\n' + '='.repeat(66));
  console.log('ИТОГ');
  console.log('='.repeat(66));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(22)} ${r.addr}  ${r.from} -> ${r.to} -> ${r.got}  ${r.ok ? 'ЗАПИСЬ' : 'только чтение'}`);
  }

  const globalOk = results[0].ok;
  const bandOk = results[1].ok && results[2].ok && results[3].ok;

  console.log('');
  if (!globalOk && bandOk) {
    console.log('  ГЛОБАЛЬНОГО выключателя EQ НЕТ.');
    console.log('  EQ включается ПО ПОЛОСАМ (бит enable каждой полосы).');
    console.log('  => /api/eq/switch должен управлять полосами, а не 0x9b:0f.');
    console.log('     Сейчас маршрут пишет в 0x9b:0f и НЕ РАБОТАЕТ,');
    console.log('     хотя отвечает ok:true (оптимистичный кеш).');
  } else if (globalOk) {
    console.log('  Глобальный выключатель 0x9b:0f РАБОТАЕТ — прежний вывод неверен.');
  } else {
    console.log('  Ни глобальный, ни полосы не приняли запись — надо разбираться.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
