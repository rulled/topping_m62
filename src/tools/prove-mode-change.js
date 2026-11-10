/**
 * СМЕНА РЕЖИМА БЕЗ MCC — восстанавливается ли устройство само.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * `0x11:0x1d` = 1 (Mobile) / 2 (Live) / 3 (Prof).
 * Смена ПЕРЕЗАГРУЖАЕТ устройство — это проверено.
 *
 * НО: `settings-service.js` при смене останавливает MCC, шлёт кадр,
 * ждёт 16 секунд и ЗАПУСКАЕТ MCC обратно — потому что считалось,
 * что без MCC устройство остаётся в промежуточном состоянии (NOTES §86).
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ СКРИПТ ═══
 *
 * Восстанавливается ли устройство САМО после перезагрузки, если MCC
 * не запущен вообще. Если да — смена режима доступна без MCC.
 *
 * ═══ МЕТОД ═══
 *
 * 1. Снимок до (режим, набор семейств).
 * 2. Отправить 0x11:0x1d = целевой режим.
 * 3. Ждать 20 секунд (устройство перезагружается).
 * 4. Снимок после: переподключилось ли, какой режим, цел ли набор.
 * 5. Вернуть исходный режим тем же способом.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG должны быть отключены — проверяется.
 * Смена режима не разрушает настройки, но перезагружает устройство.
 * Исходный режим возвращается.
 *
 * Запуск: node src/tools/prove-mode-change.js
 *        node src/tools/prove-mode-change.js --to Prof
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
const MODE_MAP = { Mobile: 1, Live: 2, Prof: 3 };
const MODE_NAMES = { 1: 'Mobile', 2: 'Live', 3: 'Prof' };

const toArg = process.argv.indexOf('--to');
const TARGET_MODE = toArg > 0 ? process.argv[toArg + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Ждёт появления HID-интерфейса, до timeoutMs. */
async function waitForDevice(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
    if (all.find((d) => d.interface === 4)) return Date.now() - t0;
    await sleep(500);
  }
  return null;
}

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

/** Снимок с определением режима. */
async function snap(ms = 16000) {
  const dev = findDev();
  if (!dev) return { error: 'устройство не найдено' };
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

  const keys = [...out.keys()];
  const has = (re) => keys.some((k) => re.test(k));
  const fams = new Set(keys.map((k) => k.slice(0, 2)));

  let mode = 'не определить';
  if (has(/^a[1-9a]:/)) mode = 'Prof';
  else if (has(/^44:(0d|0e)$/i)) mode = 'Live';
  else if (has(/^44:/)) mode = 'Mobile';

  return {
    size: out.size,
    mode,
    families: fams.size,
    hasEqHp: has(/^a[1-9a]:/),
    hasEqIn: has(/^9[1-4]:/),
    hasFx: has(/^44:/),
    hasMixer: has(/^3[1-8b-c]:/),
    hasDuck: has(/^43:/),
    map: out,
  };
}

/** Отправляет смену режима в отдельной короткой сессии. */
async function sendMode(code) {
  const dev = findDev();
  if (!dev) throw new Error('устройство не найдено');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, 0x1d, code);
  await sleep(1000);
  try { h.close(); } catch { /* ok */ }
}

const show = (s, label) => {
  if (s.error) {
    console.log(`${label}: ${s.error}`);
    return;
  }
  console.log(`${label}:`);
  console.log(`  режим:    ${s.mode}`);
  console.log(`  тегов:    ${s.size}, семейств: ${s.families}`);
  console.log(`  EQ HP:    ${s.hasEqHp ? 'да' : 'нет'}   EQ входов: ${s.hasEqIn ? 'да' : 'нет'}`);
  console.log(`  эффекты:  ${s.hasFx ? 'да' : 'нет'}   микшер: ${s.hasMixer ? 'да' : 'нет'}   ducking: ${s.hasDuck ? 'да' : 'нет'}`);
};

async function main() {
  console.log('снимок «до»…');
  const before = await snap();
  show(before, 'ДО');

  if (before.error) process.exit(2);

  if (before.map.get('64:06') === 1 || before.map.get('62:06') === 1) {
    console.log('\nОСТАНОВ: джек подключён, смена режима прервёт звук.');
    process.exit(2);
  }

  const currentMode = before.mode;
  const target = TARGET_MODE ?? (currentMode === 'Live' ? 'Prof' : 'Live');
  const targetCode = MODE_MAP[target];

  if (!targetCode) {
    console.log(`\nнеизвестный режим: ${target}. Допустимо: Mobile, Live, Prof`);
    process.exit(2);
  }
  if (target === currentMode) {
    console.log(`\nуже в режиме ${target}, менять нечего`);
    process.exit(0);
  }

  console.log(`\nсмена режима: ${currentMode} -> ${target} (код ${targetCode})`);
  console.log('MCC НЕ запущен — проверяем, восстановится ли устройство само\n');

  await sendMode(targetCode);
  console.log('кадр отправлен, устройство перезагружается…');

  // ждём, пока устройство пропадёт и вернётся
  console.log('жду возврата HID-интерфейса…');
  const waitMs = await waitForDevice(35000);
  if (waitMs === null) {
    console.log('  УСТРОЙСТВО НЕ ВЕРНУЛОСЬ за 35 секунд!');
    console.log('  Возможно, нужен MCC для восстановления (NOTES §86).');
    console.log('  Попробуй переподключить кабель.');
    process.exit(3);
  }
  console.log(`  вернулось через ${(waitMs / 1000).toFixed(1)} с`);

  // даём устройству подняться
  await sleep(5000);

  console.log('\nснимок «после»…');
  const after = await snap();
  show(after, 'ПОСЛЕ');

  console.log('\n' + '='.repeat(62));
  console.log('ИТОГ');
  console.log('='.repeat(62));

  const modeChanged = after.mode === target;
  console.log(`  режим: ${currentMode} -> ${after.mode}  ${modeChanged ? 'СМЕНИЛСЯ' : 'НЕ СМЕНИЛСЯ'}`);
  console.log(`  устройство вернулось само: ${waitMs !== null ? 'ДА' : 'НЕТ'}`);

  if (modeChanged) {
    console.log('\n  СМЕНА РЕЖИМА РАБОТАЕТ БЕЗ MCC.');
    console.log('  Устройство восстанавливается самостоятельно.');
    console.log('  Значит настройка mccFriendly в settings-service можно');
    console.log('  отключить и не требовать MCC.');
  } else {
    console.log('\n  Режим не сменился или определяется неверно.');
    console.log('  Сравни наборы выше: какой режим теперь по факту.');
  }

  // --- возврат исходного режима ---
  if (after.mode !== currentMode) {
    console.log(`\nвозвращаю ${currentMode}…`);
    await sendMode(MODE_MAP[currentMode]);
    const back = await waitForDevice(35000);
    console.log(back !== null ? `  вернулось через ${(back / 1000).toFixed(1)} с` : '  не вернулось!');
    await sleep(5000);
    const fin = await snap();
    show(fin, 'ПОСЛЕ ОТКАТА');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
