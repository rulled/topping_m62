/**
 * ТОЧНЫЕ ШКАЛЫ EQ-ДИАЛОВ — ТАБЛИЦЫ И ПЕРЕСЧЁТЫ.
 *
 * Все значения ПОЛУЧЕНЫ ЭКСПЕРИМЕНТАЛЬНО прогоном клавиатуры по дилам
 * (eq-scale-map.js, 2026-11-07, раунд 53). Проверка обратимости:
 * прогон вверх и вниз проходит через ОДНИ И ТЕ ЖЕ значения.
 *
 * ═══ FREQ: ЕСТЬ ТОЧНАЯ ФОРМУЛА ═══
 *
 *   100 шагов, f(n) = 20 * 1000^(n/100),  n = 0..100
 *
 *   f(0)   = 20 Гц
 *   f(100) = 20000 Гц
 *   шаг    = 1000^(1/100) = 1.0715193  (119.59 центов ≈ 120)
 *
 *   Проверено на 41 точке: ошибка < 1% (только округление в файле).
 *
 *   n(f) = 100 * ln(f/20) / ln(1000)
 *
 * ═══ GAIN: ЛИНЕЙНО ═══
 *
 *   шаг = 1 дБ ровно. 3 нажатия = +3.0 дБ.
 *   Диапазон по документации MCC: -12..+12. Клавиатурой упор НЕ проверен
 *   до конца (прогон ограничивали), но шаг линейный и постоянный.
 *
 * ═══ Q: ТОЛЬКО ТАБЛИЦА ═══
 *
 *   Формулы нет: ни экспонента (ошибка 20.8%), ни atan, ни 1/Q,
 *   ни sqrt не описывают шкалу. Значения идут с "шумом" квантования.
 *   РАБОЧИЙ ДИАПАЗОН: 0.1 .. 15 (46 шагов).
 *
 *   Поэтому используется ТАБЛИЦА с поиском ближайшего значения.
 *   Она снята прямым прогоном и потому ТОЧНА по построению.
 *
 *   Документация MCC заявляла 0.707..15 — НИЖНЯЯ ГРАНИЦА НЕВЕРНА:
 *   реальный минимум 0.1.
 */

/** Коэффициент шага частоты. */
export const FREQ_STEP_RATIO = Math.pow(1000, 1 / 100); // 1.0715193052376064
export const FREQ_STEPS = 100;
export const FREQ_MIN = 20;
export const FREQ_MAX = 20000;

/**
 * Частота по номеру шага.
 * @param {number} n 0..100
 * @returns {number} Гц
 */
export function freqFromStep(n) {
  const k = Math.max(0, Math.min(FREQ_STEPS, Math.round(n)));
  return Math.round(20 * Math.pow(1000, k / 100));
}

/**
 * Номер шага по частоте (ближайший).
 * @param {number} freq Гц
 * @returns {number} 0..100
 */
export function freqToStep(freq) {
  const f = Math.max(FREQ_MIN, Math.min(FREQ_MAX, Number(freq)));
  return Math.round((100 * Math.log(f / 20)) / Math.log(1000));
}

/**
 * ТАБЛИЦА Q — снята прогоном клавиатуры, по возрастанию.
 * Между соседними значениями РОВНО один шаг дила.
 */
export const Q_LADDER = [
  0.1, 0.104, 0.112, 0.119, 0.125, 0.135, 0.1405, 0.1563,
  0.1953, 0.2, 0.2168, 0.2293, 0.2441, 0.2679, 0.3052, 0.3433,
  0.3815, 0.4239, 0.4421, 0.4768, 0.5395, 0.596, 0.68, 0.707,
  0.903, 1.1642, 1.3206, 1.4552, 1.819, 2.0213, 2.2737, 2.412,
  2.5623, 2.8422, 3.1452, 3.5527, 3.8477, 4.4409, 4.9865, 5.5511,
  6.0724, 6.9389, 7.7348, 8.6736, 10.842, 13.5525, 15,
];

export const Q_MIN = Q_LADDER[0];
export const Q_MAX = Q_LADDER[Q_LADDER.length - 1];

/**
 * Ближайший индекс в таблице Q.
 * @param {number} q
 * @returns {number} индекс
 */
export function qToIndex(q) {
  const target = Number(q);
  if (!Number.isFinite(target)) return 0;
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < Q_LADDER.length; i++) {
    const err = Math.abs(Q_LADDER[i] - target);
    if (err < bestErr) { bestErr = err; best = i; }
  }
  return best;
}

/**
 * Значение Q по индексу таблицы.
 * @param {number} i
 */
export function qAtIndex(i) {
  return Q_LADDER[Math.max(0, Math.min(Q_LADDER.length - 1, Math.round(i)))];
}

/** Ближайшее достижимое значение Q. */
export function qSnap(q) {
  return qAtIndex(qToIndex(q));
}

/**
 * Сколько нажатий нужно, чтобы попасть из Q=qFrom в Q=qTo.
 * @returns {number} положительное = UP
 */
export function qPresses(qFrom, qTo) {
  return qToIndex(qTo) - qToIndex(qFrom);
}

/**
 * Сколько нажатий нужно для перехода по частоте.
 * @returns {number} положительное = UP
 */
export function freqPresses(fFrom, fTo) {
  return freqToStep(fTo) - freqToStep(fFrom);
}

/**
 * Описание шкал для API/фронта (сухие факты).
 */
export function describeScales() {
  return {
    gain: {
      kind: 'linear',
      step: 1,
      unit: 'dB',
      documentedRange: [-12, 12],
      note: 'шаг ровно 1 дБ за нажатие; упор в границы клавиатурой не проверялся',
    },
    freq: {
      kind: 'logarithmic',
      formula: 'f(n) = 20 * 1000^(n/100)',
      steps: FREQ_STEPS,
      min: FREQ_MIN,
      max: FREQ_MAX,
      stepRatio: FREQ_STEP_RATIO,
      stepCents: 119.59,
      verifiedPoints: 41,
      note: 'формула проверена на 41 измеренной точке, ошибка < 1%',
    },
    q: {
      kind: 'table',
      steps: Q_LADDER.length - 1,
      min: Q_MIN,
      max: Q_MAX,
      ladder: Q_LADDER,
      note: 'формулы нет; таблица снята прогоном и точна по построению',
      warning: 'документированный минимум 0.707 НЕВЕРЕН — реальный 0.1',
    },
  };
}
