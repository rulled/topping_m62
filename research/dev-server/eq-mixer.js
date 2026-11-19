/**
 * EQ и микшер M62 — каталог адресов и статус.
 *
 * ГЛАВНЫЙ ВЫВОД ЖИВОГО СЪЁМА (2026-11-07, research/LIVE-CAPTURE.md):
 * ни EQ, ни микшер через HID НЕ управляются.
 *
 *   - Адреса EQ восстановлены из кода MCC, но в HID-потоке их НЕТ:
 *     в полном снимке состояния (55 параметров) нет ни одного тега EQ,
 *     семейства 0xab нет вообще. Проверено перебором.
 *   - Микшер: я перебрал все 21 слайдер, включая 10 каналов матрицы Mix A.
 *     Значение в приложении меняется, в HID не приходит ничего.
 *
 * Поэтому структуры EQ и микшера оставлены ТОЛЬКО как справка о том,
 * что существует в устройстве. Использовать их как адреса HID-протокола
 * НЕЛЬЗЯ — это не подтверждено и живым съёмом опровергнуто.
 *
 * ЕДИНСТВЕННОЕ, что здесь рабочее и проверенное — FX_INPUT_LEVELS.
 *
 * Модуль намеренно НЕ содержит функций записи.
 */

/**
 * EQ, КОМПРЕССОР, ЭКВАЛАЙЗЕРЫ — ПОДТВЕРЖДЕНО ПЕРЕХВАТОМ СТАРТА MCC.
 *
 * Метод: слушатель HID + жёсткий перезапуск M Control Center. MCC при
 * инициализации отправляет всё состояние, слушатель ловит целиком.
 * Лог: research/sessions/restart-capture.jsonl, отчёт: research/FULL-MAP.md
 *
 * В устройство я не писал — писал MCC.
 */

/** Компрессор. Снят целиком при старте MCC. */
export const COMPRESSOR = [
  { id: 'compSwitch', name: 'Compressor on/off', target: 0x46, prop: 0x01, value: 0 },
  { id: 'compThreshold', name: 'Threshold', target: 0x46, prop: 0x02, value: -18, unit: 'dB' },
  { id: 'compRatio', name: 'Ratio', target: 0x46, prop: 0x03, value: 40 },
  { id: 'compAttack', name: 'Attack', target: 0x46, prop: 0x04, value: 5, unit: 'ms' },
  { id: 'compRelease', name: 'Release', target: 0x46, prop: 0x05, value: 200, unit: 'ms' },
  { id: 'compGain', name: 'Makeup gain', target: 0x46, prop: 0x06, value: 0 },
  { id: 'compGainAuto', name: 'Gain auto', target: 0x46, prop: 0x07, value: 0 },
  { id: 'compMix', name: 'Dry/wet mix', target: 0x46, prop: 0x08, value: 100 },
];

/**
 * Блоки эквалайзеров. Каждый — 10 параметров.
 * Значения при старте повторяются: 0, 1, 0, 632, 7000 (×2).
 *
 * Гипотеза (правдоподобная, но НЕ подтверждённая): PP 1..5 — полосы 1..5
 * левого канала, PP 6..0a — правого; в пятёрке значения означают
 * {тип, Q, gain, частота, ?}.
 */
export const EQ_BANKS = [
  { id: 'eqBank91', target: 0x91, params: 10 },
  { id: 'eqBank92', target: 0x92, params: 10 },
  { id: 'eqBank93', target: 0x93, params: 10 },
  { id: 'eqBank94', target: 0x94, params: 10 },
];

/** Уровни входов блока эффектов (FX). ПОДТВЕРЖДЕНО ЖИВЫМ СЪЁМОМ 2026-11-07. */
export const FX_INPUT_LEVELS = [
  { id: 'fxIn1', name: 'FX IN1 level', target: 0x44, prop: 0x01, min: -90, max: 12, verified: true },
  { id: 'fxIn2', name: 'FX IN2 level', target: 0x44, prop: 0x02, min: -90, max: 12, verified: true },
  { id: 'fxAux', name: 'FX AUX level', target: 0x44, prop: 0x03, min: -90, max: 12, verified: true },
  { id: 'fxBt',  name: 'FX BT level',  target: 0x44, prop: 0x04, min: -90, max: 12, verified: true },
  { id: 'fxOtg', name: 'FX OTG level', target: 0x44, prop: 0x05, min: -90, max: 12, verified: true },
];

/** Эквалайзеры. gain/min/max = null означает «не установлено». */
export const EQUALIZERS = [
  {
    id: 'eqIn1',
    name: 'EQ IN 1',
    object: 'EQ_IN1',
    bands: 4,
    switch: { target: 0x9b, prop: 0x0f },
    gain: { target: 0x9b, prop: 0x0d },
    extra: { target: 0x9b, prop: 0x12 },
    min: null,
    max: null,
  },
  {
    id: 'eqIn2',
    name: 'EQ IN 2',
    object: 'EQ_IN2',
    bands: 4,
    switch: { target: 0x9b, prop: 0x10 },
    gain: { target: 0x9b, prop: 0x0e },
    extra: { target: 0x9b, prop: 0x13 },
    min: null,
    max: null,
  },
  {
    id: 'eqHp',
    name: 'EQ Headphone',
    object: 'EQ_HP',
    bands: 10,
    switch: { target: 0xab, prop: 0x0f },
    gain: { target: 0xab, prop: 0x14 },
    extra: null,
    min: null,
    max: null,
  },
];

/**
 * Каналы микшера в том порядке, в каком их возвращает резолвер MCC
 * (функция 0x22c0a0). Каждый канал стереофонический.
 */
export const MIXER_CHANNELS = [
  { id: 'in12',   name: 'IN 1+2',       index: 0 },
  { id: 'otgin',  name: 'OTG IN',       index: 1 },
  { id: 'fx',     name: 'FX',           index: 2 },
  { id: 'pb12',   name: 'Playback 1/2', index: 3 },
  { id: 'pb34',   name: 'Playback 3/4', index: 4 },
  { id: 'pb56',   name: 'Playback 5/6', index: 5 },
  { id: 'pb78',   name: 'Playback 7/8', index: 6 },
  { id: 'aux',    name: 'AUX',          index: 7 },
  { id: 'bt',     name: 'BT',           index: 8 },
];

/** Шины микшера. Цвета — из кода MCC, для первых трёх. */
export const MIXER_BUSES = [
  { id: 'A', name: 'Mix A', base: 0x4100, color: '#43CF7C' },
  { id: 'B', name: 'Mix B', base: 0x4200, color: '#00AAFF' },
  { id: 'C', name: 'Mix C', base: 0x4300, color: '#FFEB3B' },
  { id: 'D', name: 'Mix D', base: 0x4400, color: null },
  { id: 'E', name: 'Mix E', base: 0x4500, color: null },
  { id: 'F', name: 'Mix F', base: 0x4600, color: null },
  { id: 'G', name: 'Mix G', base: 0x4700, color: null },
  { id: 'H', name: 'Mix H', base: 0x4800, color: null },
];

/**
 * Сколько шин реально показывает устройство — зависит от режима.
 * Источник: мануал M62, таблица режимов.
 */
export const MIXER_BUSES_BY_MODE = {
  mobile: 0,   // микшера нет
  live: 5,     // Mix A–E
  pro: 3,      // Mix A–C
  unknown: null,
};

/**
 * Тег микшера — ОПРОВЕРГНУТАЯ ГИПОТЕЗА. Не использовать.
 *
 * Ранее я выводил формулу `база_шины | номер_канала` из кода MCC.
 * Живой съём 2026-11-07 её опроверг: перебор всех 10 каналов матрицы Mix A
 * не дал ни одной реакции в HID-потоке.
 *
 * Дополнительно: `0x44` оказался занят под Input2Level и уровни FX
 * (это подтверждено прямым экспериментом), а формула отдавала его
 * под Mix B/R.
 *
 * Функция оставлена только для истории разбора. Использовать её результат
 * как адрес НЕЛЬЗЯ.
 *
 * @deprecated опровергнуто живым съёмом, см. research/LIVE-CAPTURE.md
 */
export function mixerTag(busIndex, channelIndex) {
  const bus = MIXER_BUSES[busIndex];
  if (!bus) throw new Error(`нет такой шины: ${busIndex}`);
  if (channelIndex < 0 || channelIndex >= MIXER_CHANNELS.length) {
    throw new Error(`нет такого канала: ${channelIndex}`);
  }
  return bus.base | channelIndex;
}

/** Разложить тег микшера обратно. null, если это не тег микшера. */
export function parseMixerTag(tag) {
  const tt = (tag >> 8) & 0xff;
  if (tt < 0x41 || tt > 0x48) return null;
  const bus = MIXER_BUSES[tt - 0x41];
  if (!bus) return null;
  const ch = MIXER_CHANNELS[tag & 0xff];
  if (!ch) return null;
  return { bus, channel: ch };
}

/** Тег EQ по id эквалайзера и виду параметра. */
export function eqTag(id, kind) {
  const eq = EQUALIZERS.find((x) => x.id === id);
  if (!eq) throw new Error(`неизвестный эквалайзер: ${id}`);
  const p = eq[kind];
  if (!p) throw new Error(`у ${id} нет параметра ${kind}`);
  return (p.target << 8) | p.prop;
}

/**
 * Полное описание для API/фронта.
 *
 * Поля `viaHid` и `available` — главные: фронт должен по ним решать,
 * что рисовать. Для EQ и микшера `viaHid: false` — рисовать НЕЛЬЗЯ.
 */
export function describeEqMixer() {
  return {
    equalizers: EQUALIZERS.map((eq) => ({
      id: eq.id,
      name: eq.name,
      object: eq.object,
      bands: eq.bands,
      switch: { target: eq.switch.target, prop: eq.switch.prop },
      gain: {
        target: eq.gain.target,
        prop: eq.gain.prop,
        min: eq.min,
        max: eq.max,
      },
      bandParamsAvailable: false,
      // ПЕРЕХВАТ СТАРТА MCC: теги 0x9b:0x0f/0x10/0x12/0x13 приходят.
      viaHid: eq.id !== 'eqHp',
      available: eq.id !== 'eqHp',
      note: eq.id === 'eqHp'
        ? '0xab:0x0f при старте не пришёл — доступен только в Pro audio mode'
        : 'теги приходят при старте MCC, значения 0 (EQ выключен)',
    })),
    mixer: {
      channels: MIXER_CHANNELS,
      buses: MIXER_BUSES,
      busesByMode: MIXER_BUSES_BY_MODE,
      stereo: true,
      gainRangeKnown: false,
      // Проверено перебором всех 21 слайдера: реакции в HID нет.
      viaHid: false,
      available: false,
      uiRange: { min: -90, max: 12 },
    },
    fxInputLevels: FX_INPUT_LEVELS.map((f) => ({ ...f, viaHid: true, available: true })),
    compressor: COMPRESSOR.map((c) => ({ ...c, viaHid: true, available: true })),
    eqBanks: EQ_BANKS.map((b) => ({ ...b, viaHid: true, available: true })),
    caveats: [
      'уровни FX (0x44:0x01..0x05) — подтверждено живым съёмом',
      'компрессор (0x46:0x01..0x08) — снят перехватом старта MCC',
      'EQ-переключатели 0x9b:0x0f/0x10/0x12/0x13 — приходят при старте',
      '4 блока эквалайзеров по 10 параметров (0x91..0x94) — сняты при старте',
      'EQ наушников (0xab:0x0f) не приходит — только Pro audio mode',
      'микшер через HID НЕ управляется — в стартовом пакете отсутствует',
      'смысл параметров 0x91..0x94 — гипотеза, не подтверждён',
    ],
  };
}
