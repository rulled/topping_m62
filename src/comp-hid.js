/**
 * КОМПРЕССОР ЧЕРЕЗ HID — запись без M Control Center.
 *
 * ═══ ЧТО ЭТО ЗАМЕНЯЕТ ═══
 *
 * Раньше `src/comp-control.js` открывал окно компрессора в MCC
 * и двигал дилы через UIAutomation.
 *
 * Проверено 2026-11-10 на живом устройстве (MCC закрыт), чтение
 * в новой сессии, откат ОК:
 *
 *   Threshold  0x46:02  -28 -> -20    принято
 *   Ratio      0x46:03   40 -> 60     принято
 *   Attack     0x46:04    5 -> 10     принято
 *   Release    0x46:05  200 -> 300    принято
 *   Mix        0x46:08  100 -> 90     принято
 *
 * Инструмент: `src/tools/comp-write-direct.js`.
 *
 * ═══ АДРЕСА ═══
 *
 *   0x46:0x01 = Switch
 *   0x46:0x02 = Threshold, дБ
 *   0x46:0x03 = Ratio x10 (4.0 -> 40)
 *   0x46:0x04 = Attack, мс
 *   0x46:0x05 = Release, мс
 *   0x46:0x06 = Gain (makeup)
 *   0x46:0x07 = Gain auto
 *   0x46:0x08 = Mix, 0..100
 *
 * ═══ ОСОБЕННОСТЬ RATIO ═══
 *
 * Ratio передаётся умноженным на 10: 4.0 -> 40, 10.0 -> 100.
 * Значение 1000000 означает «бесконечность» (limit).
 */

const TT_COMP = 0x46;

/**
 * Параметр -> свойство и как он масштабируется.
 * `scale` — делитель при чтении и множитель при записи.
 */
export const COMP_FIELDS = {
  switch: { prop: 0x01, scale: 1, min: 0, max: 1, unit: '' },
  threshold: { prop: 0x02, scale: 1, min: -36, max: 0, unit: 'dB' },
  ratio: { prop: 0x03, scale: 10, min: 0.1, max: 100, unit: ':1' },
  attack: { prop: 0x04, scale: 1, min: 1, max: 500, unit: 'ms' },
  release: { prop: 0x05, scale: 1, min: 1, max: 601, unit: 'ms' },
  gain: { prop: 0x06, scale: 1, min: 0, max: 36, unit: 'dB' },
  gainAuto: { prop: 0x07, scale: 1, min: 0, max: 1, unit: '' },
  mix: { prop: 0x08, scale: 1, min: 0, max: 100, unit: '%' },
};

export const COMP_FIELD_NAMES = Object.keys(COMP_FIELDS);

/** Ratio «бесконечность» в том виде, как его отдаёт устройство. */
export const RATIO_INFINITY = 1000000;

/** Границы для API. */
export function compLimits() {
  const out = {};
  for (const [name, f] of Object.entries(COMP_FIELDS)) {
    out[name] = { min: f.min, max: f.max, unit: f.unit, scale: f.scale };
  }
  return out;
}

/** Проверка значения, бросает с понятным текстом. */
export function validateCompValue(field, value) {
  const f = COMP_FIELDS[field];
  if (!f) throw new Error(`неизвестный параметр: ${field}; допустимо ${COMP_FIELD_NAMES.join(', ')}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field}: ожидалось число, получили "${value}"`);
  if (n < f.min || n > f.max) {
    throw new Error(`${field}: значение ${n} вне диапазона ${f.min}..${f.max}${f.unit ? ' ' + f.unit : ''}`);
  }
  return n;
}

/** Из человеческого значения в то, что ждёт устройство. */
export function toDeviceValue(field, value) {
  const f = COMP_FIELDS[field];
  if (!f) throw new Error(`неизвестный параметр: ${field}`);
  if (field === 'ratio') return Math.round(value * f.scale);
  return Math.round(value);
}

/** Обратно: из устройства в человеческое. */
export function fromDeviceValue(field, raw) {
  if (raw === null || raw === undefined) return null;
  const f = COMP_FIELDS[field];
  if (!f) return raw;
  if (field === 'ratio') {
    if (raw === RATIO_INFINITY) return Infinity;
    return raw / f.scale;
  }
  return raw;
}

/**
 * Кадры для установки параметра.
 * @returns {Array<{target: number, prop: number, value: number}>}
 */
export function buildCompFrames(field, value) {
  const v = validateCompValue(field, value);
  const f = COMP_FIELDS[field];
  return [{ target: TT_COMP, prop: f.prop, value: toDeviceValue(field, v) }];
}

/**
 * Читает все параметры компрессора из снимка.
 * Поддерживает оба формата ключей (hex и decimal).
 */
export function readCompressor(snapshot) {
  const get = (prop) => {
    if (snapshot instanceof Map) {
      for (const [k, v] of snapshot) {
        const [a, b] = String(k).split(':');
        if (a === undefined || b === undefined) continue;
        if (parseInt(a, 16) !== TT_COMP && Number(a) !== TT_COMP) continue;
        if (parseInt(b, 16) === prop || Number(b) === prop) return v;
      }
      return null;
    }
    const hexKey = `46:${prop.toString(16).padStart(2, '0')}`;
    if (snapshot[hexKey] !== undefined) return snapshot[hexKey];
    const decKey = `70:${prop}`;
    if (snapshot[decKey] !== undefined) return snapshot[decKey];
    return null;
  };

  const out = {};
  for (const field of COMP_FIELD_NAMES) {
    const raw = get(COMP_FIELDS[field].prop);
    out[field] = fromDeviceValue(field, raw);
  }
  return out;
}

/** Описание для API. */
export function describeCompHid() {
  return {
    fields: COMP_FIELD_NAMES,
    limits: compLimits(),
    addresses: Object.fromEntries(
      Object.entries(COMP_FIELDS).map(([k, f]) => [k, `0x46:0x${f.prop.toString(16).padStart(2, '0')}`]),
    ),
    note: 'Ratio передаётся умноженным на 10 (4.0 -> 40). 1000000 означает бесконечность.',
  };
}
