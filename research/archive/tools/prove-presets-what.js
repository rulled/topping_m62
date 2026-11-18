/**
 * ПРЕСЕТЫ: ЧТО ИМЕННО В НИХ ВХОДИТ.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * Кнопки в MCC:
 *   Save preset1  0x11:0x08 = 1
 *   Save preset2  0x11:0x08 = 2
 *   Load preset1  0x11:0x0e = 1
 *   Load preset2  0x11:0x0e = 2
 *
 * `probe-presets.js` дал нестабильный результат — 10, потом 1, потом
 * 0 изменений. Причина найдена: дамп плавает (probe-dump-stability.js).
 * Метод «снимок до / снимок после» ненадёжен.
 *
 * ═══ ПРАВИЛЬНЫЙ МЕТОД ═══
 *
 * 1. Снять ПОЛНЫЙ дамп (≥100 тегов, повторы при неудаче).
 * 2. Изменить НЕСКОЛЬКО параметров вручную (например, громкости
 *    и реверб) — так, чтобы изменение было заведомо видимым.
 * 3. Сохранить пресет 2.
 * 4. Изменить параметры ЕЩЁ РАЗ (на другие значения).
 * 5. Загрузить пресет 2.
 * 6. Снять полный дамп и сравнить с состоянием на шаге 2.
 *
 * Если после загрузки значения вернулись к шагу 2 — пресет
 * сохраняет эти параметры.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняются громкости (небольшие сдвиги) и реверб (Bypass).
 * Всё возвращается. Наушники и OTG проверяются.
 *
 * Запуск: node src/tools/prove-presets-what.js
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
const PP_SAVE_PRESET = 0x08;
const PP_LOAD_PRESET = 0x0e;
const PRESET = 2;

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
    if (!dev) return best;
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
    while (Date.now() - t0 < 16000) {
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

async function cmd(tt, pp, value) {
  const dev = findDev();
  if (!dev) throw new Error('устройство не найдено');
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

const NOISE = new Set([
  '11:18', '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02', '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01', '9b:0b',
]);

/** Только изменения значения в тегах из ОБОИХ снимков. */
function diff(a, b) {
  const out = [];
  for (const [k, v] of a) {
    if (NOISE.has(k)) continue;
    if (!b.has(k)) continue;
    if (b.get(k) !== v) out.push({ key: k, from: v, to: b.get(k) });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/** Меняем несколько параметров, чтобы получить заметное состояние. */
async function setParamsA() {
  // громкость HP и AUX, реверб dryWet — при типе LIVE
  await cmd(0x44, 0x0b, 3);          // реверб LIVE (чтобы параметры писались)
  await cmd(0x44, 0x08, 40);         // dryWet 40
  await cmd(0x46, 0x04, 10);         // компрессор attack 10
  await cmd(0x21, 0x04, 40);         // громкость MIC-1 40
}

async function setParamsB() {
  await cmd(0x44, 0x08, 60);         // dryWet 60
  await cmd(0x46, 0x04, 20);         // attack 20
  await cmd(0x21, 0x04, 55);         // громкость MIC-1 55
}

async function restore() {
  await cmd(0x44, 0x08, 30);
  await cmd(0x44, 0x0b, 1);          // реверб обратно в Bypass
  await cmd(0x46, 0x04, 5);
  await cmd(0x21, 0x04, 43);
}

async function main() {
  console.log('шаг 1: снимок исходного состояния…');
  const s0 = await fullSnap();
  console.log(`  ${s0.size} тегов`);

  const hp = s0.get('64:06');
  const otg = s0.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg})`);
    process.exit(2);
  }

  console.log('\nшаг 2: ставлю состояние A (реверб LIVE, dryWet 40, attack 10, mic1 40)…');
  await setParamsA();
  await sleep(2000);
  const sA = await fullSnap();
  console.log(`  ${sA.size} тегов, dryWet=${sA.get('44:08')} attack=${sA.get('46:04')} mic1=${sA.get('21:04')}`);

  console.log(`\nшаг 3: сохраняю пресет ${PRESET}…`);
  await cmd(0x11, PP_SAVE_PRESET, PRESET);
  await sleep(2000);
  const sSaved = await fullSnap();
  const dSave = diff(sA, sSaved);
  console.log(`  сохранение изменило ${dSave.length} тег(ов) (должно быть 0)`);

  console.log('\nшаг 4: ставлю состояние B (dryWet 60, attack 20, mic1 55)…');
  await setParamsB();
  await sleep(2000);
  const sB = await fullSnap();
  console.log(`  ${sB.size} тегов, dryWet=${sB.get('44:08')} attack=${sB.get('46:04')} mic1=${sB.get('21:04')}`);

  console.log(`\nшаг 5: загружаю пресет ${PRESET}…`);
  await cmd(0x11, PP_LOAD_PRESET, PRESET);
  await sleep(4000);
  const sLoaded = await fullSnap();
  console.log(`  ${sLoaded.size} тегов, dryWet=${sLoaded.get('44:08')} attack=${sLoaded.get('46:04')} mic1=${sLoaded.get('21:04')}`);

  console.log('\n' + '='.repeat(64));
  console.log('ЧТО ИЗМЕНИЛОСЬ ПРИ ЗАГРУЗКЕ ПРЕСЕТА (B -> пресет)');
  console.log('='.repeat(64));
  const dLoad = diff(sB, sLoaded);
  if (!dLoad.length) {
    console.log('  ничего не изменилось');
  } else {
    for (const x of dLoad) console.log(`  0x${x.key}  ${x.from} -> ${x.to}`);
  }

  console.log('\n' + '='.repeat(64));
  console.log('СОВПАДАЕТ ЛИ С СОСТОЯНИЕМ A (что было при сохранении)');
  console.log('='.repeat(64));
  const back = [
    { name: 'реверб тип', key: '44:0b', want: sA.get('44:0b') },
    { name: 'реверб dryWet', key: '44:08', want: sA.get('44:08') },
    { name: 'компрессор attack', key: '46:04', want: sA.get('46:04') },
    { name: 'громкость MIC-1', key: '21:04', want: sA.get('21:04') },
  ];
  let restored = 0;
  for (const r of back) {
    const got = sLoaded.get(r.key);
    const ok = got === r.want;
    if (ok) restored += 1;
    console.log(`  ${r.name.padEnd(20)} при сохранении ${r.want}, после загрузки ${got}  ${ok ? 'ВОССТАНОВЛЕНО' : 'нет'}`);
  }

  console.log(`\n  восстановлено: ${restored} из ${back.length}`);

  console.log('\nвозвращаю исходное состояние…');
  await restore();
  await sleep(2000);
  const fin = await fullSnap();
  console.log(`  dryWet=${fin.get('44:08')} attack=${fin.get('46:04')} mic1=${fin.get('21:04')} тип=${fin.get('44:0b')}`);

  console.log('\n' + '='.repeat(64));
  console.log('ВЫВОД');
  console.log('='.repeat(64));
  if (restored === back.length) {
    console.log('  Пресет сохраняет и восстанавливает аудио-параметры:');
    console.log('  реверб, компрессор, громкости.');
  } else if (restored > 0) {
    console.log(`  Пресет восстанавливает ЧАСТЬ параметров (${restored} из ${back.length}).`);
    console.log('  Смотри таблицу выше, что именно.');
  } else {
    console.log('  Пресет НЕ восстановил ни один из проверенных параметров.');
    console.log('  Либо он хранит другое, либо загрузка не применилась.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
