/**
 * ПРЕСЕТЫ И СЦЕНЫ: что реально делает устройство.
 *
 * ═══ ЧТО ЕСТЬ В MCC ═══
 *
 * Кнопки (координаты при окне 1650x967):
 *   Chat          (1518, 580)   — сцена
 *   Vocal         (1518, 619)   — сцена
 *   Load preset1  (1518, 708)
 *   Load preset2  (1518, 748)
 *   Save preset1  (1518, 787)
 *   Save preset2  (1518, 826)
 *
 * ═══ ЧТО УЖЕ ИЗВЕСТНО ═══
 *
 * Сцены (проверено ранее, NOTES §26):
 *   Chat  `0x45:0x01` -> включает ducking (0x43:0x07 = 1)
 *   Vocal `0x45:0x02` -> выключает ducking
 *   Воспроизводится стабильно.
 *   ВАЖНО: мануал говорит «Chat отключает реверб», но фактически
 *   сцена реверб НЕ трогает — только ducking.
 *
 * Пресеты (NOTES §26):
 *   save preset1 `0x11:0x08`
 *   load preset1 `0x11:0x0e`
 *   Загрузка возвращает ПОЛНОЕ состояние. Сохранение — команда,
 *   состояние не меняется.
 *
 * ═══ ЧТО НЕ ПРОВЕРЕНО ═══
 *
 * 1. Что именно попадает в пресет. NOTES §32 говорит: аудио-состояние
 *    (эффекты, FX-уровни, шумоподавление, реверб) — да, настройки
 *    устройства (яркость, BT, питание) — нет. Но это проверялось
 *    косвенно.
 * 2. Есть ли пресеты 3/4 (в UI только 1 и 2).
 * 3. Восстанавливает ли load пресет микшер и loopback (они же
 *    не читаются из устройства — значит проверить сложно).
 *
 * ═══ ЗАЧЕМ ЭТОТ СКРИПТ ═══
 *
 * Снимает состояние, посылает load preset, снимает снова и показывает
 * РАЗНИЦУ. Так видно, что именно пресет меняет. Это безопасно:
 * пресет в устройстве уже есть, мы его только загружаем.
 *
 * Запуск: node src/tools/probe-presets.js
 *        node src/tools/probe-presets.js --save   (проверить save)
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

const DO_SAVE = process.argv.includes('--save');
const VID = 0x152a;
const PID = 0x875c;

const PP_SAVE_PRESET = 0x08;
const PP_LOAD_PRESET = 0x0e;
const PP_SCENE_CHAT = 0x01;
const PP_SCENE_VOCAL = 0x02;
const TT_SCENE = 0x45;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

/** Снимок в новой сессии (EQ приходит только на первый announce). */
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

/** Посылает одну команду в отдельной сессии. */
async function command(tt, pp, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(tt, pp, value);
  await sleep(1500);
  try { h.close(); } catch { /* ok */ }
}

/**
 * Метры — это поток, они меняются постоянно и в diff попадают как шум.
 * Отфильтровываем их, иначе реальные изменения тонут.
 *
 * Список взят из src/tags.js (METERS) плюс известные метры эффектов
 * и компрессора.
 */
const METER_KEYS = new Set([
  '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02',
  '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01',
  '9b:0b',
  '11:18',  // счётчик запусков: растёт при каждом подключении
]);

const isMeter = (key) => METER_KEYS.has(key);

/** Что изменилось между снимками, без метра. */
function diff(a, b) {
  const out = [];
  for (const [k, v] of b) {
    if (isMeter(k)) continue;
    const was = a.get(k);
    if (was === undefined) {
      out.push({ key: k, from: '(нет)', to: v, kind: 'появился' });
    } else if (was !== v) {
      out.push({ key: k, from: was, to: v, kind: 'изменился' });
    }
  }
  for (const [k, v] of a) {
    if (isMeter(k)) continue;
    if (!b.has(k)) out.push({ key: k, from: v, to: '(пропал)', kind: 'пропал' });
  }
  return out;
}

async function main() {
  console.log('снимок «до»…');
  const before = await snap();
  console.log(`  тегов: ${before.size}`);

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg})`);
    process.exit(2);
  }

  // --- СЦЕНЫ ---
  console.log('\n' + '='.repeat(60));
  console.log('СЦЕНА CHAT (0x45:0x01)');
  console.log('='.repeat(60));
  await command(TT_SCENE, PP_SCENE_CHAT, 1);
  await sleep(1500);
  const afterChat = await snap();
  const dChat = diff(before, afterChat);
  if (!dChat.length) {
    console.log('  ничего не изменилось');
  } else {
    for (const d of dChat) {
      console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('СЦЕНА VOCAL (0x45:0x02)');
  console.log('='.repeat(60));
  await command(TT_SCENE, PP_SCENE_VOCAL, 2);
  await sleep(1500);
  const afterVocal = await snap();
  const dVocal = diff(afterChat, afterVocal);
  if (!dVocal.length) {
    console.log('  ничего не изменилось');
  } else {
    for (const d of dVocal) {
      console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);
    }
  }

  // --- ПРЕСЕТЫ ---
  console.log('\n' + '='.repeat(60));
  console.log('ЗАГРУЗКА ПРЕСЕТА 1 (0x11:0x0e = 1)');
  console.log('='.repeat(60));
  const beforeLoad = await snap();
  await command(0x11, PP_LOAD_PRESET, 1);
  await sleep(3000);
  const afterLoad = await snap();
  const dLoad = diff(beforeLoad, afterLoad);
  if (!dLoad.length) {
    console.log('  ничего не изменилось (пресет совпадает с текущим?)');
  } else {
    console.log(`  изменилось ${dLoad.length} тег(ов):`);
    for (const d of dLoad) {
      console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);
    }
  }

  if (DO_SAVE) {
    console.log('\n' + '='.repeat(60));
    console.log('СОХРАНЕНИЕ ПРЕСЕТА 2 (0x11:0x08 = 2)');
    console.log('='.repeat(60));
    const beforeSave = await snap();
    await command(0x11, PP_SAVE_PRESET, 2);
    await sleep(2000);
    const afterSave = await snap();
    const dSave = diff(beforeSave, afterSave);
    console.log(`  изменилось ${dSave.length} тег(ов) — сохранение не должно менять состояние`);
    for (const d of dSave) {
      console.log(`  ${d.key}  ${d.from} -> ${d.to}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  console.log(`
  Сцена Chat изменила: ${dChat.length} тег(ов)
  Сцена Vocal изменила: ${dVocal.length} тег(ов)
  Загрузка пресета 1:  ${dLoad.length} тег(ов)

  Ожидалось по прежним замерам: сцена трогает только ducking
  (0x43:0x07), пресет возвращает аудио-состояние.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});

