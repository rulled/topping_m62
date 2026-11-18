/**
 * ШКАЛЫ ГЕЙНОВ M62 — по данным mainline-драйвера.
 *
 * ═══ ПОЧЕМУ ЭТОТ ФАЙЛ ПЕРЕПИСАН ═══
 *
 * Раньше в проекте считалось, что громкость входа приходит «как есть»,
 * то есть сырое значение = дБ. Это НЕВЕРНО. Данные взяты из
 * опубликованного драйвера ядра (`sound/usb/mixer_topping.c`, серия
 * v10, см. `research/LINUX-DRIVER.md`), где для каждого контрола задана
 * своя кривая.
 *
 * ═══ ДВЕ РАЗНЫЕ ШКАЛЫ ═══
 *
 * Шкала `out_9` — для AUX и выхода на наушники:
 *     шаг 0        MUTE
 *     шаг 1..19    от −88 дБ, шаг 2 дБ
 *     шаг 20..61   от −51 дБ, шаг 1 дБ
 *     шаг 62..99   от −9.5 дБ, шаг 0.5 дБ
 *
 * Шкала `out_0` — для BT, OTG IN и выхода OTG:
 *     шаг 0        MUTE
 *     шаг 1..79    от −88 дБ, шаг 1 дБ
 *     шаг 80..99   от −9.5 дБ, шаг 0.5 дБ
 *
 * Шкала `gain` — для микрофонных входов IN 1 и IN 2:
 *     шаг 0..88    0 дБ .. +88 дБ, шаг 1 дБ (это аналоговый
 *                  предусилитель, он только прибавляет)
 *
 * ═══ ЗАЧЕМ ЭТО ВАЖНО ═══
 *
 * Показывать «шаг 81» вместо «0 дБ» — не косметика. Пользователь,
 * выкрутив ползунок «до 81», решит, что это +81 дБ, хотя это ровно
 * номинал. На таком непонимании легко сжечь слух или оборудование.
 */

/** Кривые из драйвера: имя -> функция шаг -> дБ (null = mute). */
export const GAIN_CURVES = {
  /**
   * Микрофонный предусилитель: 0..88 дБ, шаг 1 дБ.
   * В драйвере: `topping_tlv_gain = DECLARE_TLV_DB_SCALE(0, 100, 0)`.
   */
  mic: (step) => {
    if (step === null || step === undefined) return null;
    if (step < 0) return null;
    return step;
  },

  /**
   * Шкала out_9 (AUX, HP).
   * В драйвере: TLV с тремя диапазонами.
   */
  out9: (step) => {
    if (step === null || step === undefined) return null;
    if (step <= 0) return null;              // 0 = MUTE
    if (step <= 19) return -88 + (step - 1) * 2;
    if (step <= 61) return -51 + (step - 20) * 1;
    if (step <= 99) return -9.5 + (step - 62) * 0.5;
    return null;
  },

  /**
   * Шкала out_0 (BT, OTG IN, OTG OUT).
   */
  out0: (step) => {
    if (step === null || step === undefined) return null;
    if (step <= 0) return null;              // 0 = MUTE
    if (step <= 79) return -88 + (step - 1) * 1;
    if (step <= 99) return -9.5 + (step - 80) * 0.5;
    return null;
  },
};

/**
 * Какой кривой описывается контрол.
 *
 * Адреса и кривые — из таблицы `topping_m62_ctls` драйвера.
 */
export const GAIN_CONTROLS = {
  '0x21:0x04': { name: 'IN 1', curve: 'mic', min: 0, max: 88, unit: 'dB' },
  '0x22:0x04': { name: 'IN 2', curve: 'mic', min: 0, max: 88, unit: 'dB' },
  '0x23:0x04': { name: 'AUX', curve: 'out9', min: 0, max: 99, unit: 'dB' },
  '0x25:0x04': { name: 'BT', curve: 'out0', min: 0, max: 99, unit: 'dB' },
  '0x27:0x04': { name: 'OTG IN', curve: 'out0', min: 0, max: 99, unit: 'dB' },
  '0x64:0x03': { name: 'HP', curve: 'out9', min: 0, max: 99, unit: 'dB' },
  '0x62:0x03': { name: 'OTG OUT', curve: 'out0', min: 0, max: 99, unit: 'dB' },
};

/** Символы для красивого вывода. */
const MINUS = '\u2212';

/**
 * Шаг -> человеческое значение.
 *
 * @param {number} step сырое значение с карты
 * @param {'mic'|'out9'|'out0'|string} curve
 * @returns {string} например "0 dB", "−6 dB", "MUTE"
 */
export function formatGain(step, curve) {
  const fn = GAIN_CURVES[curve];
  if (!fn) return String(step);
  const db = fn(step);
  if (db === null) return 'MUTE';
  if (db === 0) return '0 dB';
  // Полшага показываем как 0.5, целые — без дробной части
  const txt = Number.isInteger(db) ? String(db) : db.toFixed(1);
  return `${txt.replace('-', MINUS)} dB`;
}

/**
 * Шаг -> число дБ (или null для mute).
 * @param {number} step
 * @param {string} curve
 * @returns {number|null}
 */
export function gainDb(step, curve) {
  const fn = GAIN_CURVES[curve];
  if (!fn) return null;
  return fn(step);
}

/**
 * Число дБ -> ближайший шаг. Для установки значения из UI.
 *
 * @param {number|null} db  null = mute
 * @param {string} curve
 * @returns {number}
 */
export function gainStep(db, curve) {
  if (db === null || db === undefined) return 0;

  // Для микрофонного входа шкала простая
  if (curve === 'mic') return Math.max(0, Math.min(88, Math.round(db)));

  const max = curve === 'out9' ? 99 : 99;
  // Ищем ближайший шаг перебором: шкала кусочная, аналитически
  // выводить формулу ради 100 шагов не стоит.
  let best = 0;
  let bestDiff = Infinity;
  for (let s = 1; s <= max; s += 1) {
    const v = GAIN_CURVES[curve](s);
    if (v === null) continue;
    const diff = Math.abs(v - db);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

/**
 * Проверить ключевые точки кривых — для тестов.
 *
 * Значения взяты из драйвера, где они записаны как «первый шаг,
 * который пишется при bind»:
 *   AUX      81 -> 0 дБ
 *   BT, OTG  99 -> 0 дБ
 *   HP        0 -> тишина
 */
export function curveCheckpoints() {
  return [
    { curve: 'mic', step: 0, db: 0 },
    { curve: 'mic', step: 88, db: 88 },
    { curve: 'out9', step: 0, db: null },
    { curve: 'out9', step: 81, db: 0 },
    { curve: 'out9', step: 99, db: 9 },
    { curve: 'out0', step: 0, db: null },
    { curve: 'out0', step: 99, db: 0 },
  ];
}
