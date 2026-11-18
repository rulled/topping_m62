/**
 * ПРОВЕРКА: mutes, loopback-гейны и селекторы.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Адреса и таблицы взяты из опубликованного драйвера ядра. Ошибка
 * здесь не косметическая:
 *
 *   • mute инвертирован (1 = заглушено): перепутав, вместо звука
 *     получишь тишину или наоборот — внезапный звук в наушниках;
 *   • loopback-гейн пишется в ДВА адреса: забыв второй, получишь
 *     расхождение каналов;
 *   • селектор отвечает на ОДИН адрес, а не на пару;
 *   • значения селектора имеют дыру на 4 и 5 — «номер пункта» не
 *     равен значению на проводе.
 *
 * Каждый из этих пунктов проверяется отдельно, плюс контрпримеры.
 *
 * Запуск: node src/tools/test-mutes-loopback.js
 */

import {
  LB_GAIN_MAX_STEP,
  LB_GAIN_Q25,
  LB_GAIN_UNITY_STEP,
  LOOPBACK_RETURNS,
  MUTE_CONTROLS,
  SELECTORS,
  SOURCE_DEFAULT,
  SOURCE_ITEMS,
  buildLoopbackGainFrames,
  buildMuteFrames,
  buildSelectorFrames,
  lbStepToDb,
  readAllMutes,
  readMute,
  readSelector,
  sourceLabel,
} from '../mutes-loopback.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

console.log('='.repeat(70));
console.log('MUTES, LOOPBACK, СЕЛЕКТОРЫ — ПО ДАННЫМ ДРАЙВЕРА');
console.log('='.repeat(70));

// ═══ MUTES ═══
console.log('\n--- mutes: инверсия ---');
{
  const mic1 = MUTE_CONTROLS.find((c) => c.id === 'mic1');
  check('IN 1: адрес 0x21:0x05', mic1.target === 0x21 && mic1.prop === 0x05);

  // Главное: звук ВКЛЮЧЁН -> на провод идёт 0
  const on = buildMuteFrames(mic1, true);
  check('звук включён -> на провод 0 (инверсия)',
    on[0].value === 0, JSON.stringify(on));

  const off = buildMuteFrames(mic1, false);
  check('звук выключен -> на провод 1',
    off[0].value === 1, JSON.stringify(off));

  // Пара: наушники пишутся в 0x64 и 0x63
  const hp = MUTE_CONTROLS.find((c) => c.id === 'hp');
  const hpFrames = buildMuteFrames(hp, true);
  check('HP mute пишется в ОБА адреса пары',
    hpFrames.length === 2
    && hpFrames.some((f) => f.target === 0x64)
    && hpFrames.some((f) => f.target === 0x63),
    JSON.stringify(hpFrames));

  // У моно-входа пары нет
  check('IN 1 без пары -> один кадр', on.length === 1);

  // Чтение: 0 = звук идёт, 1 = заглушено
  const snap = { '33:5': 0, '34:5': 1, '100:4': 0, '99:4': 0 };
  check('readMute: 0 на проводе = звук идёт', readMute(snap, mic1) === true);
  const mic2 = MUTE_CONTROLS.find((c) => c.id === 'mic2');
  check('readMute: 1 на проводе = заглушено', readMute(snap, mic2) === false);
  check('readMute: нет значения -> null', readMute({}, mic1) === null);

  const all = readAllMutes(snap);
  check('readAllMutes вернул все 7', Object.keys(all).length === 7,
    String(Object.keys(all).length));
  check('readAllMutes: HP прочитан', all.hp === true);

  check('всего mute-контролов 7', MUTE_CONTROLS.length === 7,
    String(MUTE_CONTROLS.length));
}

// ═══ LOOPBACK ГЕЙНЫ ═══
console.log('\n--- loopback-гейны ---');
{
  check('4 возврата', LOOPBACK_RETURNS.length === 4);

  const lb12 = LOOPBACK_RETURNS[0];
  check('LB 1/2: гейн 0x51, пара 0x52, селектор 0x51',
    lb12.gainTarget === 0x51 && lb12.gainPair === 0x52 && lb12.selTarget === 0x51);

  // Гейн пишется в оба адреса
  const frames = buildLoopbackGainFrames(lb12, 90);
  check('гейн пишется в ДВА адреса',
    frames.length === 2
    && frames.some((f) => f.target === 0x51)
    && frames.some((f) => f.target === 0x52),
    JSON.stringify(frames));
  check('оба кадра с prop 0x03', frames.every((f) => f.prop === 0x03));

  // 0 дБ = шаг 90 = 2^25
  check('шаг 90 = 2^25 (0 дБ)',
    LB_GAIN_Q25[90] === 33554432, String(LB_GAIN_Q25[90]));
  check('LB_GAIN_UNITY_STEP = 90', LB_GAIN_UNITY_STEP === 90);

  // Шаг 0 = mute
  check('шаг 0 = 0 (mute)', LB_GAIN_Q25[0] === 0);
  const muted = buildLoopbackGainFrames(lb12, 0);
  check('mute loopback = гейн в 0', muted[0].value === 0);

  // Таблица монотонна
  let monotonic = true;
  for (let i = 2; i < LB_GAIN_Q25.length; i += 1) {
    if (LB_GAIN_Q25[i] <= LB_GAIN_Q25[i - 1]) monotonic = false;
  }
  check('таблица Q25 монотонно растёт', monotonic);

  check('таблица 103 значения', LB_GAIN_Q25.length === 103,
    String(LB_GAIN_Q25.length));

  // дБ из шага
  check('шаг 90 -> 0 дБ', lbStepToDb(90) === 0);
  check('шаг 102 -> +12 дБ', lbStepToDb(102) === 12);
  check('шаг 1 -> −89 дБ', lbStepToDb(1) === -89);
  check('шаг 0 -> null (mute)', lbStepToDb(0) === null);

  // Ограничение диапазона
  const over = buildLoopbackGainFrames(lb12, 999);
  check('шаг > максимума обрезается',
    over[0].value === LB_GAIN_Q25[LB_GAIN_MAX_STEP], String(over[0].value));
  const under = buildLoopbackGainFrames(lb12, -5);
  check('отрицательный шаг -> 0', under[0].value === 0);
}

// ═══ СЕЛЕКТОРЫ ═══
console.log('\n--- селекторы ---');
{
  check('6 селекторов', SELECTORS.length === 6, String(SELECTORS.length));
  check('14 пунктов источников', SOURCE_ITEMS.length === 14,
    String(SOURCE_ITEMS.length));

  // Дыра на 4 и 5: пункт 3 = Mix C, пункт 4 = IN 1 со значением 6
  const values = SOURCE_ITEMS.map((s) => s.value);
  check('значения: 4 и 5 отсутствуют (дыра)',
    !values.includes(4) && !values.includes(5),
    values.join(','));
  check('после 3 идёт 6', values[2] === 3 && values[3] === 6,
    `${values[2]},${values[3]}`);
  check('последнее значение 16', values[values.length - 1] === 16);

  // Playback 1/2 — это 12, и это значение по умолчанию
  const pb12 = SOURCE_ITEMS.find((s) => s.label === 'Playback 1/2');
  check('Playback 1/2 = 12', pb12.value === 12, String(pb12.value));
  check('значение по умолчанию 12', SOURCE_DEFAULT === 12);

  // Селектор пишет ОДИН кадр
  const hpSel = SELECTORS.find((s) => s.id === 'hpSrc');
  const frame = buildSelectorFrames(hpSel, 12);
  check('селектор -> ОДИН кадр', frame.length === 1, JSON.stringify(frame));
  check('селектор на 0x64:0x02',
    frame[0].target === 0x64 && frame[0].prop === 0x02);

  // Loopback-селектор пишет в ПЕРВЫЙ адрес пары (не в пару)
  const lbSel = SELECTORS.find((s) => s.id === 'lb12Src');
  const lbFrame = buildSelectorFrames(lbSel, 12);
  check('loopback-селектор -> один кадр в 0x51',
    lbFrame.length === 1 && lbFrame[0].target === 0x51,
    JSON.stringify(lbFrame));

  // Неизвестное значение отклоняется
  let threw = false;
  try { buildSelectorFrames(hpSel, 4); } catch { threw = true; }
  check('значение 4 (дыра) отклоняется', threw);

  // Названия
  check('sourceLabel(12) = Playback 1/2', sourceLabel(12) === 'Playback 1/2');
  check('sourceLabel(6) = IN 1', sourceLabel(6) === 'IN 1');
  check('sourceLabel(999) -> "?"', sourceLabel(999).startsWith('?'));

  // Селекторы не читаются картой
  check('readSelector: не отдаёт -> null',
    readSelector({}, hpSel) === null);
}

console.log(`\n${'='.repeat(70)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
