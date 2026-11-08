/**
 * КЛАССИФИКАТОР ВСЕХ ИЗВЕСТНЫХ ТЕГОВ.
 *
 * Сводит воедино всё, что найдено реверсом и проверено на устройстве:
 * настройки, эффекты, компрессор, EQ, метры.
 *
 * Нужен, чтобы фронт получал осмысленные события вместо "unknown".
 */

/** Метры уровня — значения меняются постоянно, это НЕ состояние. */
export const METERS = new Map([
  [0x2101, 'IN1'],
  [0x2501, 'BT'],
  [0x2601, 'ch26'],
  [0x3115, 'out1'],
  [0x3215, 'out2'],
  [0x3315, 'ch1'],
  [0x3415, 'ch2'],
  [0x3515, 'ch3'],
  [0x3615, 'ch4'],
  [0x3901, 'meter39_1'],
  [0x3902, 'meter39_2'],
  [0x440d, 'fxIn'],
  [0x440e, 'fxOut'],
  [0x4609, 'comp9'],
  [0x460c, 'comp12'],
  [0x460d, 'comp13'],
  [0x6101, 'otgOutL'],
  [0x6201, 'otgOutR'],
  [0x6301, 'hpL'],
  [0x6401, 'hpR'],
  [0x9b0b, 'eqMeter'],
  [0x460a, 'comp10'],
]);

/**
 * РОЛИ МЕТРОВ КОМПРЕССОРА — измерено 2026-11-07 (NOTES §114).
 *
 *   comp12 (0x460c) — уровень ДО компрессора
 *   comp13 (0x460d) — уровень ПОСЛЕ компрессора
 *   => Gain Reduction = comp13 − comp12  (отрицательное = сжатие работает)
 *
 * Проверено: при Threshold=0 и Ratio=∞, gain 80:
 *   до включения  comp12=-596 comp13=-679
 *   после         comp12=-623 comp13=-733   → редукция -54 raw = -5.4 dB
 *
 *   comp9  (0x4609) — КОНСТАНТА -800, не меняется никогда → не метр
 *   comp10 (0x460a) — всегда 0, канал не используется → не метр
 */
export const COMP_METER_ROLES = {
  before: 'comp12',
  after: 'comp13',
  /** Условные метры: присутствуют в потоке, но значения не несут. */
  constants: { comp9: -800, comp10: 0 },
};

/** Редукция усиления по двум метрам компрессора, в дБ. */
export function gainReductionDb(beforeRaw, afterRaw) {
  if (!Number.isFinite(beforeRaw) || !Number.isFinite(afterRaw)) return null;
  return Math.round(((afterRaw - beforeRaw) / METER_SCALE.divisor) * 10) / 10;
}

/** Эффекты (TT=0x44) — имена из таблицы MCC. */
export const FX_PARAMS = new Map([
  [0x4401, { id: 'fxIn1Level', name: 'FX IN1 level' }],
  [0x4402, { id: 'fxIn2Level', name: 'FX IN2 level' }],
  [0x4403, { id: 'fxAuxLevel', name: 'FX AUX level' }],
  [0x4404, { id: 'fxBtLevel', name: 'FX BT level' }],
  [0x4405, { id: 'fxOtgLevel', name: 'FX OTG level' }],
  [0x4406, { id: 'noiseReduction', name: 'Noise Reduction' }],
  [0x4407, { id: 'noiseReductionType', name: 'Noise Reduction type' }],
  [0x4408, { id: 'reverbDryWet', name: 'Reverb dry/wet' }],
  [0x4409, { id: 'reverbRoom', name: 'Reverb room' }],
  [0x440a, { id: 'reverbDecay', name: 'Reverb decay' }],
  [0x440b, { id: 'reverbType', name: 'Reverb type' }],
  [0x440c, { id: 'muteFx', name: 'Mute FX' }],
  [0x440f, { id: 'reverbWidth', name: 'Reverb width' }],
]);

/** Компрессор (TT=0x46).
 *
 * ВАЖНО ПРО ШКАЛЫ (проверено, research/NOTES.md §44):
 * приходят ТОЛЬКО после Load preset (`0x11:0x0e` или `0x11:0x12`).
 * Обычный ANNOUNCE их не отдаёт — только метры `0x4609`, `0x460a`.
 *
 * Сверка с файлом workspace:
 *   Threshold  -30 = -30   равны
 *   Ratio       40 vs 4    **HID = файл × 10**
 *   Attack       5 = 5     равны
 *   Release    200 = 200   равны
 *   Gain         0 = 0     равны
 *   Mix        100 = 100   равны
 */
export const COMP_PARAMS = new Map([
  [0x4601, { id: 'compSwitch', name: 'Compressor on/off' }],
  [0x4602, { id: 'compThreshold', name: 'Threshold', unit: 'dB' }],
  [0x4603, { id: 'compRatio', name: 'Ratio', scale: 10, note: 'HID = значение × 10' }],
  [0x4604, { id: 'compAttack', name: 'Attack', unit: 'ms' }],
  [0x4605, { id: 'compRelease', name: 'Release', unit: 'ms' }],
  [0x4606, { id: 'compGain', name: 'Makeup gain' }],
  [0x4607, { id: 'compGainAuto', name: 'Gain auto' }],
  [0x4608, { id: 'compMix', name: 'Mix' }],
]);

/** Ducking (TT=0x43). */
export const DUCK_PARAMS = new Map([
  [0x4301, { id: 'duckThreshold', name: 'Ducking threshold' }],
  [0x4302, { id: 'duckAttack', name: 'Ducking attack' }],
  [0x4303, { id: 'duckReduction', name: 'Ducking reduction' }],
  [0x4304, { id: 'duckRelease', name: 'Ducking release' }],
  [0x4305, { id: 'duckMapIn1', name: 'Ducking map IN1' }],
  [0x4306, { id: 'duckMapIn2', name: 'Ducking map IN2' }],
  [0x4307, { id: 'duckSwitch', name: 'Ducking on/off' }],
]);

/** EQ-переключатели (TT=0x9b). */
export const EQ_SWITCHES = new Map([
  [0x9b0d, { id: 'eqIn1Gain', name: 'EQ IN1 gain' }],
  [0x9b0e, { id: 'eqIn2Gain', name: 'EQ IN2 gain' }],
  [0x9b0f, { id: 'eqIn1Switch', name: 'EQ IN1 on/off' }],
  [0x9b10, { id: 'eqIn2Switch', name: 'EQ IN2 on/off' }],
  [0x9b12, { id: 'eqIn1Extra', name: 'EQ IN1 param 2' }],
  [0x9b13, { id: 'eqIn2Extra', name: 'EQ IN2 param 2' }],
  [0xab0f, { id: 'eqHpSwitch', name: 'EQ HP on/off' }],
  [0xab14, { id: 'eqHpGain', name: 'EQ HP gain' }],
]);

/** Состояние джеков и подключений. */
export const JACKS = new Map([
  [0x2106, { id: 'in1Present', name: 'IN1 connected' }],
  [0x2206, { id: 'in2Present', name: 'IN2 connected' }],
  [0x2306, { id: 'auxPresent', name: 'AUX connected' }],
  [0x2506, { id: 'btPresent', name: 'BT connected' }],
  [0x6206, { id: 'otgPresent', name: 'OTG connected' }],
  [0x6406, { id: 'hpPresent', name: 'Headphone connected' }],
]);

/** Версия/идентификация (TT=0x12). */
export const IDENTITY = new Map([
  [0x1201, 'id01'], [0x1202, 'id02'], [0x1203, 'id03'],
  [0x1204, 'id04'], [0x1205, 'id05'], [0x1206, 'id06'],
]);

/** Громкости (из mainline-драйвера). */
export const VOLUME_TAGS = new Map([
  [0x2104, { id: 'mic1', name: 'Mic-1 volume' }],
  [0x2204, { id: 'mic2', name: 'Mic-2 volume' }],
  [0x2304, { id: 'aux', name: 'Aux volume' }],
  [0x2504, { id: 'bt', name: 'Bluetooth volume' }],
  [0x2704, { id: 'otgin', name: 'OTG volume' }],
  [0x6303, { id: 'hp', name: 'Headphone volume' }],
  [0x6403, { id: 'hpPair', name: 'Headphone volume (pair)' }],
  [0x6103, { id: 'otgout', name: 'OTG out volume' }],
  [0x6203, { id: 'otgoutPair', name: 'OTG out volume (pair)' }],
]);

/**
 * Мьюты выходов — ГИПОТЕЗА, не подтверждённая до конца.
 *
 * ИСПРАВЛЕНО (2026-11-07): раньше `0x6404`/`0x6204` назывались
 * «playback volume» — это было точно НЕВЕРНО. Громкость выходов в
 * таблице mainline-драйвера живёт в пропе `0x03` (см. VOLUME_TAGS),
 * а `0x04` в драйвере не упомянут вовсе.
 *
 * Что известно твёрдо:
 *  - `0x64:0x04` и `0x62:0x04` приходят ровно во ВТОРОЙ волне announce
 *    (t≈5.29/5.30 с в нашем съёме), а драйвер v7 описывает вторую волну
 *    как «the output mutes»;
 *  - в состоянии «мьют выключен» оба тега = 0;
 *  - запись `0x64:0x04 = 1` устройство ПРИНИМАЕТ и возвращает 1 на
 *    следующий ANNOUNCE (проверено `src/tools/probe-mute-rw.js`).
 *
 * Что НЕ подтвердилось:
 *  - запись `0x64:0x04 = 1` НЕ переключила кнопку MUTE в UI MCC
 *    (`src/tools/test-output-mute.js`), а UI-переключение не сдвинуло
 *    тег (`src/tools/mute-vs-tag.js`) — хотя там UI-мьют не держался
 *    в состоянии On, так что тест нечистый.
 *
 * Итог: значение тега читать можно, писать — под вопросом.
 */
export const OUTPUT_MUTE_TAGS = new Map([
  [0x6404, { id: 'hpMute', name: 'Headphone mute (hypothesis)' }],
  [0x6204, { id: 'otgMute', name: 'OTG out mute (hypothesis)' }],
]);

/** Селекторы источников. */
export const SELECTOR_TAGS = new Map([
  [0x6402, { id: 'hpSource', name: 'Headphone source' }],
  [0x6202, { id: 'otgSource', name: 'OTG source' }],
]);

const ALL = [
  ['fx', FX_PARAMS],
  ['comp', COMP_PARAMS],
  ['duck', DUCK_PARAMS],
  ['eq', EQ_SWITCHES],
  ['jack', JACKS],
  ['volume', VOLUME_TAGS],
  ['outputMute', OUTPUT_MUTE_TAGS],
  ['selector', SELECTOR_TAGS],
];

/**
 * Классифицировать событие по тегу.
 *
 * @param {{target:number, prop:number, value:number}} ev
 * @returns {{kind:string, id?:string, name?:string}|null}
 */
export function classifyTag(ev) {
  const tag = (ev.target << 8) | ev.prop;

  // метры — самые частые, проверяем первыми
  const meter = METERS.get(tag);
  if (meter !== undefined) {
    return { kind: 'meter', id: `meter_${meter}`, name: `Meter ${meter}` };
  }

  for (const [kind, map] of ALL) {
    const def = map.get(tag);
    if (def) {
      return { kind, ...(typeof def === 'string' ? { name: def } : def) };
    }
  }

  // EQ-блоки 0x91..0x94 — по 10 параметров (2 полосы × 5 полей)
  if (ev.target >= 0x91 && ev.target <= 0x94) {
    return { kind: 'eqBand', id: `eqBank${ev.target}_${ev.prop}`, name: `EQ ${ev.target.toString(16)} band ${ev.prop}` };
  }

  // EQ наушников 0xa1..0xaa — 10 полос × 10 полей, только в Prof-режиме.
  //
  // Структура (docs/EQ-HP.md):
  //     0xa1 = полоса 1 ... 0xaa = полоса 10
  //     01..05 = левый канал, 06..0a = правый
  //     01/06 вкл, 02/07 тип, 03/08 gain, 04/09 частота, 05/0a Q×10000
  //
  // Приходят на 7-11 секунде — окно снимка в Prof должно быть >= 26 с.
  if (ev.target >= 0xa1 && ev.target <= 0xaa) {
    const band = ev.target - 0xa1 + 1;
    const ch = ev.prop <= 0x05 ? 'L' : 'R';
    const field = ev.prop <= 0x05 ? ev.prop : ev.prop - 0x05;
    const FIELD_NAMES = { 1: 'enable', 2: 'type', 3: 'gain', 4: 'freq', 5: 'q' };
    return {
      kind: 'eqHpBand',
      id: `eqHp_band${band}_${ch}_${FIELD_NAMES[field] ?? field}`,
      name: `EQ HP полоса ${band} ${ch} ${FIELD_NAMES[field] ?? field}`,
    };
  }

  // идентификация
  const ident = IDENTITY.get(tag);
  if (ident) return { kind: 'identity', id: ident, name: ident };

  return null;
}

/** Все известные метры — для фронта. */
export function listMeters() {
  return [...METERS.entries()].map(([tag, name]) => ({
    tag: `0x${tag.toString(16).padStart(4, '0')}`,
    id: `meter_${name}`,
    name,
    ...meterUnits(),
  }));
}

/**
 * ШКАЛА МЕТРОВ — измерена 2026-11-07 (NOTES §114).
 *
 * Сырое значение приходит как int16 со знаком в десятых долях dB:
 *
 *     dB = raw / 10
 *
 * Пол шкалы: **−90 dB** (raw = −902). Ниже метр не опускается — при
 * выключенном/замьюченном входе стабильно приходит ровно −902.
 *
 * Как измерено:
 *   - наклон в рабочей области (усиление 60–88) = **10.0 raw/дБ**,
 *     стабильно на интервалах 8 дБ: 10.25, 10.00, 9.88;
 *   - пол −902 / 10 = −90.2 dB, что совпадает с типичным полом −90 dB;
 *   - на больших интервалах (30–60 дБ) кажущийся наклон падает до 6–7 —
 *     это АРТЕФАКТ пола, нижняя точка обрезана −902, а не реальная кривая.
 *
 * Значение 0 в некоторых метрах (`0x460a`) — не «0 dB», а отсутствие
 * данных: этот тег всегда 0, вероятно неиспользуемый канал.
 */
export const METER_SCALE = {
  divisor: 10,
  floorRaw: -902,
  floorDb: -90.2,
  unit: 'dB',
  /** Метры, которые всегда приходят нулём — не показывать как 0 dB. */
  alwaysZero: ['comp10'],
};

/**
 * Перевести сырое значение метра в дБ.
 * @param {number} raw сырое значение из HID-события
 * @param {string} [meterName] имя метра (для учёта alwaysZero)
 * @returns {{db:number|null, raw:number, atFloor:boolean, noData:boolean}}
 */
export function meterToDb(raw, meterName) {
  if (!Number.isFinite(raw)) {
    return { db: null, raw, atFloor: false, noData: true };
  }
  if (meterName && METER_SCALE.alwaysZero.includes(meterName) && raw === 0) {
    return { db: null, raw, atFloor: false, noData: true };
  }
  const atFloor = raw <= METER_SCALE.floorRaw + 1;
  return {
    db: Math.round((raw / METER_SCALE.divisor) * 10) / 10,
    raw,
    atFloor,
    noData: false,
  };
}

/** Справочник шкалы для API. */
export function meterUnits() {
  return {
    divisor: METER_SCALE.divisor,
    unit: METER_SCALE.unit,
    min: METER_SCALE.floorDb,
    max: 0,
    floorRaw: METER_SCALE.floorRaw,
  };
}

/** Полная карта известных тегов. */
export function describeTags() {
  const out = { meters: listMeters(), groups: {} };
  for (const [kind, map] of ALL) {
    out.groups[kind] = [...map.entries()].map(([tag, def]) => ({
      tag: `0x${tag.toString(16).padStart(4, '0')}`,
      ...(typeof def === 'string' ? { name: def } : def),
    }));
  }
  out.groups.eqBands = [0x91, 0x92, 0x93, 0x94].map((t) => ({
    tag: `0x${t.toString(16)}xx`,
    count: 10,
  }));
  return out;
}
