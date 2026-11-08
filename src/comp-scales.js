/**
 * ШКАЛЫ КОМПРЕССОРА M62.
 *
 * Все значения измерены 2026-11-07 (NOTES §113) через клавиатуру на дилах
 * окна COMP (класс CompressorS1M1), открываемого кнопкой MORE.
 *
 * ДИАПАЗОНЫ И ШАГИ:
 *
 *   Threshold  -36 .. 0      dB,   шаг 1
 *   Ratio       1 .. 1000000 (:    НЕЛИНЕЙНАЯ, таблица ниже
 *   Attack      1 .. 500     ms,   шаг 1
 *   Release     1 .. 601     ms,   шаг 1
 *   Gain        0 .. 36      dB,   шаг 1
 *   Mix         0 .. 100     %,    шаг 1
 *
 * ВАЖНО ПРО Ratio:
 * до значения 4.0 шкала ЛИНЕЙНАЯ с шагом 0.1 (30 позиций: 1.0, 1.1, ... 4.0),
 * дальше — мультипликативная, с растущим шагом. Последняя позиция = 1000000
 * (обозначает «∞/Limit», так MCC кодирует бесконечное сжатие).
 * Файл хранит float с ошибкой представления (4.400000095367432 = 4.4).
 */

/** Диапазоны: min, max, шаг (для линейных). */
export const COMP_RANGES = {
  Threshold: { min: -36, max: 0, step: 1, unit: 'dB', field: 'Threshold' },
  Attack: { min: 1, max: 500, step: 1, unit: 'ms', field: 'Attack' },
  Release: { min: 1, max: 601, step: 1, unit: 'ms', field: 'Release' },
  Gain: { min: 0, max: 36, step: 1, unit: 'dB', field: 'Gain' },
  Mix: { min: 0, max: 100, step: 1, unit: '%', field: 'Mix' },
  Ratio: { min: 1, max: 1000000, step: null, unit: ':1', field: 'Ratio', table: true },
};

/** Кодировка «бесконечного» сжатия — последняя позиция Ratio. */
export const RATIO_INFINITY = 1000000;

/**
 * Лестница Ratio: значение после N нажатий UP от минимума (1.0).
 * Измерено по одному нажатию; значения округлены до 1 знака
 * (исходные — float32 с шумом представления).
 */
export const RATIO_LADDER = [
  1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9,        // 0..9
  2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,        // 10..19
  3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9,        // 20..29
  4.0,                                                      // 30
  4.4, 4.7, 5.2, 5.6, 6.1, 6.7, 7.2, 7.9, 8.6, 9.3,        // 31..40
  10.2, 11.1, 12.1, 13.1, 14.3, 15.5, 16.9, 18.4, 20.1, 21.8, // 41..50
  23.8, 25.9, 28.2, 30.7, 33.4, 36.3, 39.5, 43.0, 46.9,    // 51..59
  RATIO_INFINITY,                                           // 60
];

/** Индекс в лестнице для значения Ratio (ближайший). */
export function ratioToIndex(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  if (v >= RATIO_INFINITY) return RATIO_LADDER.length - 1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < RATIO_LADDER.length; i++) {
    const d = Math.abs(RATIO_LADDER[i] - v);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

/** Значение Ratio на позиции индекса. */
export function ratioAtIndex(index) {
  const i = Math.max(0, Math.min(RATIO_LADDER.length - 1, Math.round(index)));
  return RATIO_LADDER[i];
}

/**
 * Сколько нажатий UP (+) или DOWN (−) нужно, чтобы перейти from → to.
 * Возвращает целое со знаком; 0 если уже на месте.
 */
export function ratioPresses(from, to) {
  const a = ratioToIndex(from);
  const b = ratioToIndex(to);
  return b - a;
}

/** Привести значение к ближайшему достижимому (для валидации ввода). */
export function ratioSnap(value) {
  return ratioAtIndex(ratioToIndex(value));
}

/** Список названий параметров в порядке отображения в окне COMP. */
export const COMP_PARAMS_ORDER = ['Threshold', 'Ratio', 'Attack', 'Release', 'Gain', 'Mix'];

/**
 * Сколько нажатий нужно для линейного параметра.
 * Возвращает целое со знаком.
 */
export function linearPresses(param, from, to) {
  const r = COMP_RANGES[param];
  if (!r || r.step === null) throw new Error(`параметр ${param} не линейный`);
  return Math.round((Number(to) - Number(from)) / r.step);
}

/**
 * Универсально: нажатия для любого параметра.
 */
export function compPresses(param, from, to) {
  if (param === 'Ratio') return ratioPresses(from, to);
  return linearPresses(param, from, to);
}

/**
 * Полная нормализация значения: в диапазон + на достижимую позицию.
 */
export function compSnap(param, value) {
  if (param === 'Ratio') return ratioSnap(value);
  const r = COMP_RANGES[param];
  if (!r) throw new Error(`неизвестный параметр: ${param}`);
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error(`значение ${param} не число: ${value}`);
  return Math.max(r.min, Math.min(r.max, Math.round(v / r.step) * r.step));
}

/** Проверка, что значение достижимо на диле. */
export function compValidate(param, value) {
  const r = COMP_RANGES[param];
  if (!r) return { ok: false, reason: `неизвестный параметр: ${param}` };
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, reason: `не число: ${value}` };
  if (v < r.min || v > r.max) {
    return { ok: false, reason: `${param} = ${v} вне диапазона ${r.min}..${r.max}` };
  }
  if (param === 'Ratio') {
    const snap = ratioSnap(v);
    if (Math.abs(snap - v) > 0.001) {
      return { ok: false, reason: `Ratio ${v} недостижим; ближайший ${snap}`, suggest: snap };
    }
    return { ok: true };
  }
  if (Math.abs(v - Math.round(v)) > 0.001) {
    return { ok: false, reason: `${param} должен быть целым (шаг ${r.step})`, suggest: Math.round(v) };
  }
  return { ok: true };
}

/** Справочник для /api и документации. */
export function describeCompressor() {
  return {
    params: COMP_PARAMS_ORDER.map((p) => {
      const r = COMP_RANGES[p];
      return {
        id: p,
        min: r.min,
        max: r.max,
        step: r.step,
        unit: r.unit,
        nonlinear: Boolean(r.table),
        ...(r.table ? { ladderSize: RATIO_LADDER.length } : {}),
      };
    }),
    ratioLadder: RATIO_LADDER,
    ratioInfinity: RATIO_INFINITY,
    notes: [
      'Ratio: до 4.0 шаг 0.1, дальше мультипликативно; 1000000 = ∞',
      'значения пишутся как float32 (4.4 -> 4.400000095367432)',
      'GainAuto — отдельный переключатель, не дил',
      'Switch — переключатель в заголовке окна COMP',
    ],
  };
}
