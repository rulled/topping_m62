/**
 * DUCKING И LOOPBACK: ПИШУТСЯ ЛИ ЧЕРЕЗ HID.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * Из захватов:
 *   0x43:0x01..0x07  ducking (Threshold, Attack, Reduction, Release,
 *                    маска входов 2 байта, Switch) — IN=0, только запись
 *   0x51..0x58        loopback: 0x02 код источника, 0x03 gain Q25 —
 *                    IN=0, только запись
 *
 * То есть ОБРАТНО они не читаются. Но пишутся ли? Микшер пишется
 * только в брекете; EQ, компрессор и реверб — одиночными кадрами.
 * Ducking и loopback ещё не проверялись.
 *
 * ═══ МЕТОД ═══
 *
 * Проблема: прочитать обратно нельзя. Как понять, что запись дошла?
 *
 *   - Для loopback: изменить gain и посмотреть, не изменился ли
 *     МЕТР соответствующего выхода (0x6x:01). Если loopback идёт
 *     на выход, метры отреагируют... но это косвенно.
 *   - Для ducking: включить Switch и проверить, изменилось ли
 *     поведение — тоже косвенно.
 *
 * Прямого способа нет. Поэтому проверяем по-другому: снимаем
 * захват USBPcap? Нет, требует админа.
 *
 * Альтернатива: MCC при старте отправляет своё состояние в
 * устройство. Если мы запишем значение, а потом запустим MCC
 * с ДРУГИМ значением в файле, устройство получит значение MCC —
 * и мы не узнаем, было ли наше.
 *
 * ЧЕСТНЫЙ ВЫВОД: без обратного чтения или захвата проверить
 * применение записи нельзя. Единственное, что можно проверить —
 * что запись НЕ ЛОМАЕТ устройство и что оно не отвечает ошибкой.
 *
 * Поэтому скрипт делает то, что можно: пишет, ждёт, проверяет что
 * устройство живо и состояние других блоков не поехало.
 *
 * Запуск: node src/tools/probe-duck-loopback-write.js
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

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 16000) {
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
  return out;
}

async function writeFrames(frames, viaBracket) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  if (viaBracket) {
    send(0x11, PP_BULK_BEGIN, 1);
    await sleep(60);
  }
  for (const f of frames) {
    send(f.target, f.prop, f.value);
    await sleep(30);
  }
  if (viaBracket) {
    send(0x11, PP_BULK_BEGIN, 0);
    await sleep(80);
  }
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(1200);
  try { h.close(); } catch { /* ok */ }
}

/**
 * Что проверяем: после записи устройство должно остаться живым,
 * а метры — продолжать идти. Ducking и loopback обратно не читаются,
 * поэтому единственные наблюдаемые признаки — живой поток и метры.
 */
const KEYS_FX = ['44:06', '44:07', '44:08', '44:0b', '46:02', '46:03', '91:03'];

function checkAlive(before, after, label) {
  const missing = KEYS_FX.filter((k) => before.has(k) && !after.has(k));
  const changed = [];
  for (const k of KEYS_FX) {
    const b = before.get(k);
    const a = after.get(k);
    if (b !== undefined && a !== undefined && b !== a) {
      changed.push(`${k}: ${b} -> ${a}`);
    }
  }
  console.log(`  ${label}: тегов ${after.size}` + (missing.length ? `  ПРОПАЛИ: ${missing.join(',')}` : '')
    + (changed.length ? `  изменились: ${changed.join('; ')}` : '  прочие блоки без изменений'));
  return missing.length === 0;
}

async function main() {
  const before = await snap();
  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }
  console.log(`базовый снимок: ${before.size} тегов`);

  // --- DUCKING ---
  console.log('\n' + '='.repeat(60));
  console.log('DUCKING (0x43:01..07)');
  console.log('='.repeat(60));

  // Пишем Switch = 0 (ducking выключен) — безопасно, он и так 0.
  // И Threshold в текущее значение из INI (-30), чтобы не менять поведение.
  const duckFrames = [
    { target: 0x43, prop: 0x07, value: 0 },   // Switch выкл
    { target: 0x43, prop: 0x01, value: -30 }, // Threshold как в файле
  ];

  console.log('  пишу одиночными кадрами: Switch=0, Threshold=-30');
  await writeFrames(duckFrames, false);
  await sleep(1500);
  let s = await snap();
  checkAlive(before, s, 'после одиночной записи');

  console.log('  пишу в брекете…');
  await writeFrames(duckFrames, true);
  await sleep(1500);
  s = await snap();
  checkAlive(before, s, 'после записи в брекете');

  // --- LOOPBACK ---
  console.log('\n' + '='.repeat(60));
  console.log('LOOPBACK (0x51..0x58)');
  console.log('='.repeat(60));

  // Пишем то же, что в файле: LB12 source=FX(17) gain=0 dB(Q25 unity)
  const Q25_UNITY = 33554432;
  const lbFrames = [
    { target: 0x51, prop: 0x02, value: 17 },        // LB12 источник FX
    { target: 0x51, prop: 0x03, value: Q25_UNITY }, // LB12 gain 0 dB
    { target: 0x52, prop: 0x03, value: Q25_UNITY }, // LB12 R
  ];

  console.log('  пишу одиночными кадрами: LB12 = FX, 0 dB');
  await writeFrames(lbFrames, false);
  await sleep(1500);
  s = await snap();
  checkAlive(before, s, 'после одиночной записи');

  console.log('  пишу в брекете…');
  await writeFrames(lbFrames, true);
  await sleep(1500);
  s = await snap();
  checkAlive(before, s, 'после записи в брекете');

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  console.log(`
  Ducking и loopback НЕ читаются обратно (IN=0 во всех захватах),
  поэтому подтвердить применение записи этим способом нельзя.

  Что проверено: устройство приняло кадры и осталось живым —
  поток не прервался, другие блоки не поехали.

  Чтобы доказать применение, нужен захват USBPcap (админ):
  там видно, что MCC шлёт при старте, и можно сравнить.
  Либо косвенно: loopback с ненулевым gain на выход → метры выхода
  должны вырасти, если сигнал есть.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
