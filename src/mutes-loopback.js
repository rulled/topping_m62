/**
 * MUTES, LOOPBACK-ГЕЙНЫ И СЕЛЕКТОРЫ M62 — по данным драйвера ядра.
 *
 * ═══ ИСТОЧНИК ═══
 *
 * Всё взято из опубликованного драйвера (`sound/usb/mixer_topping.c`,
 * серия патчей v10). См. `research/CONTROLS-MAP.md` — там полная
 * таблица с пояснениями.
 *
 * ═══ MUTES: ИНВЕРСИЯ ═══
 *
 * Карта принимает **1 = заглушено**. Переключатель «звук идёт» —
 * это инверсия: нажали «включить» -> пишем 0.
 * Перепутать легко, а последствие громкое: вместо включения звука
 * получится тишина (или наоборот — внезапный звук в наушниках).
 *
 * ═══ LOOPBACK: ДВА АДРЕСА ═══
 *
 * У loopback-возврата гейн пишется в ОБА адреса пары (`0x51` и
 * `0x52`), а селектор — только в ПЕРВЫЙ (`0x51`).
 * У выходов наоборот: гейн в оба, селектор во ВТОРОЙ.
 *
 * ═══ ЧЕГО НЕТ ═══
 *
 * У loopback-возвратов НЕТ отдельного mute. Драйвер проверял:
 * запись 1 в `0x04`/`0x05` их не глушит, а гейн в нулевой шаг —
 * глушит. Поэтому «mute» для loopback = гейн в 0.
 */

// ───────────────────────────────────────────────────────────────────
// MUTES
// ───────────────────────────────────────────────────────────────────

/**
 * Переключатель mute.
 *
 * `pair` — второй адрес пары (писать в оба). `inverted` — карта
 * принимает 1 как «заглушено», значит UI-значение инвертируется.
 *
 * @typedef {object} MuteControl
 * @property {string} id
 * @property {string} name
 * @property {number} target   первый адрес пары
 * @property {number} prop     свойство mute
 * @property {number|null} pair второй адрес пары (null = пары нет)
 */

/**
 * Переключатели mute.
 *
 * `pair` — второй адрес пары (писать в оба). `inverted` — карта
 * принимает 1 как «заглушено», значит UI-значение инвертируется.
 *
 * @type {MuteControl[]}
 */
export const MUTE_CONTROLS = [
  { id: 'mic1', name: 'IN 1', target: 0x21, prop: 0x05, pair: null },
  { id: 'mic2', name: 'IN 2', target: 0x22, prop: 0x05, pair: null },
  { id: 'aux', name: 'AUX', target: 0x23, prop: 0x05, pair: null },
  { id: 'bt', name: 'BT', target: 0x25, prop: 0x05, pair: null },
  { id: 'otgIn', name: 'OTG IN', target: 0x27, prop: 0x05, pair: null },
  { id: 'hp', name: 'Наушники', target: 0x64, prop: 0x04, pair: 0x63 },
  { id: 'otgOut', name: 'OTG OUT', target: 0x62, prop: 0x04, pair: 0x61 },
];

/**
 * Кадры для переключения mute.
 *
 * @param {MuteControl} control одна запись из MUTE_CONTROLS
 * @param {boolean} soundOn true = звук должен идти (mute снят)
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildMuteFrames(control, soundOn) {
  if (!control) throw new Error('buildMuteFrames: нужен control');
  // Карта: 1 = заглушено. Значит «звук идёт» = 0.
  const wire = soundOn ? 0 : 1;
  const frames = [{ target: control.target, prop: control.prop, value: wire }];
  if (control.pair) {
    frames.push({ target: control.pair, prop: control.prop, value: wire });
  }
  return frames;
}

/**
 * Прочитать состояние mute из снимка.
 *
 * @param {Record<string,number>} snap снимок ядра (ключи десятичные)
 * @param {MuteControl} control
 * @returns {boolean|null} true = звук идёт; null = не прочитано
 */
export function readMute(snap, control) {
  if (!snap || !control) return null;
  const key = `${control.target}:${control.prop}`;
  const v = snap[key];
  if (v === undefined || v === null) return null;
  return v === 0; // 1 = mute -> звук не идёт
}

/**
 * Карта mute-состояний: id -> boolean|null.
 * @param {Record<string,number>} snap
 * @returns {Record<string, boolean|null>}
 */
export function readAllMutes(snap) {
  const out = {};
  for (const c of MUTE_CONTROLS) out[c.id] = readMute(snap, c);
  return out;
}

// ───────────────────────────────────────────────────────────────────
// LOOPBACK
// ───────────────────────────────────────────────────────────────────

/**
 * Loopback-возврат: гейн пишется в оба адреса пары, селектор — в первый.
 *
 * @typedef {object} LoopbackReturn
 * @property {string} id
 * @property {string} name
 * @property {number} gainTarget первый адрес пары гейна
 * @property {number} gainPair   второй адрес пары гейна
 * @property {number} selTarget  адрес селектора источника
 */

/**
 * Loopback-возвраты: гейн + селектор источника.
 *
 * `gainTarget`/`gainPair` — гейн пишется в оба.
 * `selTarget` — селектор только в первый из пары.
 *
 * @type {LoopbackReturn[]}
 */
export const LOOPBACK_RETURNS = [
  { id: 'lb12', name: 'Loopback 1/2', gainTarget: 0x51, gainPair: 0x52, selTarget: 0x51 },
  { id: 'lb34', name: 'Loopback 3/4', gainTarget: 0x53, gainPair: 0x54, selTarget: 0x53 },
  { id: 'lb56', name: 'Loopback 5/6', gainTarget: 0x55, gainPair: 0x56, selTarget: 0x55 },
  { id: 'lb78', name: 'Loopback 7/8', gainTarget: 0x57, gainPair: 0x58, selTarget: 0x57 },
];

/**
 * Таблица Q25 для loopback-гейна, 103 значения.
 *
 * Индекс 0 = mute (гейн выключен), индекс n = (n − 90) дБ.
 * Значения — ровно те, что пишет приложение Topping, из драйвера
 * (`topping_m62_lb_gain`).
 */
export const LB_GAIN_Q25 = [
  0, 1190, 1335, 1498, 1681, 1886,
  2117, 2375, 2665, 2990, 3355, 3764,
  4224, 4739, 5318, 5966, 6694, 7511,
  8428, 9456, 10610, 11905, 13358, 14988,
  16817, 18869, 21171, 23754, 26653, 29905,
  33554, 37648, 42242, 47396, 53180, 59669,
  66949, 75119, 84284, 94569, 106108, 119055,
  133582, 149882, 168170, 188690, 211714, 237547,
  266532, 299054, 335544, 376486, 422425, 473968,
  531801, 596691, 669498, 751190, 842849, 945692,
  1061084, 1190556, 1335825, 1498821, 1681705, 1886904,
  2117141, 2375471, 2665323, 2990541, 3355443, 3764869,
  4224252, 4739689, 5318019, 5966915, 6694989, 7511901,
  8428492, 9456923, 10610843, 11905561, 13358259, 14988214,
  16817052, 18869043, 21171415, 23754718, 26653232, 29905418,
  33554432, 37648691, 42242527, 47396894, 53180190, 59669155,
  66949893, 75119016, 84284922, 94569238, 106108430, 119055617,
  133582599,
];

/** Шаг, соответствующий 0 дБ (индекс 90 = 2^25). */
export const LB_GAIN_UNITY_STEP = 90;

/** Максимальный шаг loopback-гейна. */
export const LB_GAIN_MAX_STEP = 102;

/**
 * Кадры для установки loopback-гейна.
 *
 * @param {LoopbackReturn} ret запись из LOOPBACK_RETURNS
 * @param {number} step 0..102
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildLoopbackGainFrames(ret, step) {
  if (!ret) throw new Error('buildLoopbackGainFrames: нужен ret');
  const s = Math.max(0, Math.min(LB_GAIN_MAX_STEP, Math.round(step)));
  const q25 = LB_GAIN_Q25[s];
  return [
    { target: ret.gainTarget, prop: 0x03, value: q25 },
    { target: ret.gainPair, prop: 0x03, value: q25 },
  ];
}

/**
 * Шаг -> дБ (или null для нулевого шага).
 * @param {number} step
 * @returns {number|null}
 */
export function lbStepToDb(step) {
  if (step === null || step === undefined) return null;
  if (step <= 0) return null;
  return step - LB_GAIN_UNITY_STEP;
}

// ───────────────────────────────────────────────────────────────────
// СЕЛЕКТОРЫ ИСТОЧНИКОВ
// ───────────────────────────────────────────────────────────────────

/**
 * Пункты селектора — как их показывает приложение Topping.
 *
 * ВАЖНО: номер пункта НЕ равен значению на проводе. У значений
 * дыра: после Mix C (3) сразу идёт IN 1 (6), потому что 4 и 5
 * зарезервированы под то, чего в этой карте нет.
 */
export const SOURCE_ITEMS = [
  { label: 'Mix A', value: 1 },
  { label: 'Mix B', value: 2 },
  { label: 'Mix C', value: 3 },
  { label: 'IN 1', value: 6 },
  { label: 'IN 2', value: 7 },
  { label: 'IN 1+2', value: 8 },
  { label: 'AUX', value: 9 },
  { label: 'BT', value: 10 },
  { label: 'OTG IN', value: 11 },
  { label: 'Playback 1/2', value: 12 },
  { label: 'Playback 3/4', value: 13 },
  { label: 'Playback 5/6', value: 14 },
  { label: 'Playback 7/8', value: 15 },
  { label: 'Playback 9/10', value: 16 },
];

/** Значение по умолчанию (Playback 1/2 = 12). */
export const SOURCE_DEFAULT = 12;

/**
 * Селектор источника.
 *
 * @typedef {object} Selector
 * @property {string} id
 * @property {string} name
 * @property {number} target адрес селектора
 * @property {number} prop   свойство селектора
 */

/**
 * Селекторы источников (только Pro Audio Mode).
 *
 * Отвечают на ОДИН адрес: выход — второй из пары, loopback — первый.
 *
 * @type {Selector[]}
 */
export const SELECTORS = [
  { id: 'hpSrc', name: 'Наушники слушают', target: 0x64, prop: 0x02 },
  { id: 'otgSrc', name: 'OTG слушает', target: 0x62, prop: 0x02 },
  { id: 'lb12Src', name: 'Loopback 1/2 берёт', target: 0x51, prop: 0x02 },
  { id: 'lb34Src', name: 'Loopback 3/4 берёт', target: 0x53, prop: 0x02 },
  { id: 'lb56Src', name: 'Loopback 5/6 берёт', target: 0x55, prop: 0x02 },
  { id: 'lb78Src', name: 'Loopback 7/8 берёт', target: 0x57, prop: 0x02 },
];

/**
 * Кадр для установки селектора.
 *
 * @param {{target:number, prop:number}} sel адрес селектора
 * @param {number} value значение на проводе (из SOURCE_ITEMS)
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildSelectorFrames(sel, value) {
  if (!sel) throw new Error('buildSelectorFrames: нужен sel');
  const known = SOURCE_ITEMS.some((s) => s.value === value);
  if (!known) throw new Error(`buildSelectorFrames: неизвестный источник ${value}`);
  return [{ target: sel.target, prop: sel.prop, value }];
}

/**
 * Прочитать селектор из снимка.
 *
 * Селекторы карта НЕ отдаёт (подтверждено драйвером: «a selector has
 * no front-panel control and is never reported»), поэтому обычно
 * вернёт null — это честный ответ, а не ошибка.
 *
 * @param {Record<string,number>} snap
 * @param {{target:number, prop:number}} sel
 * @returns {number|null}
 */
export function readSelector(snap, sel) {
  if (!snap || !sel) return null;
  const v = snap[`${sel.target}:${sel.prop}`];
  return v === undefined ? null : v;
}

/** Название источника по значению на проводе. */
export function sourceLabel(value) {
  return SOURCE_ITEMS.find((s) => s.value === value)?.label ?? `? (${value})`;
}
