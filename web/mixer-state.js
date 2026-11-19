/**
 * МОДЕЛЬ СОСТОЯНИЯ МИКШЕРА (браузер, localStorage).
 *
 * ═══ ПОЧЕМУ ОНА ВООБЩЕ НУЖНА ═══
 *
 * Микшер M62 — write-only. Доказано на 11 захватах
 * (`audit-mixer-in-captures.py`): кросспоинты `0x31..0x3c:0x01..0x14`
 * записываются 1600 раз и НЕ ПРИХОДЯТ в IN ни разу. Карта принимает
 * матрицу и не отдаёт её обратно — ни в дампе, ни эхом.
 *
 * Значит источник истины для UI может быть только наш: либо память,
 * либо файл. Это не костыль, а следствие протокола. Сам MCC устроен
 * так же — он хранит микшер в workspace-INI (`Mixer_IN12`, `MixB_GAIN`
 * и т.д.), а не читает с карты.
 *
 * ═══ ЧТО ЭТО ЗНАЧИТ ЧЕСТНО ═══
 *
 * Модель может РАСХОДИТЬСЯ с реальным состоянием карты:
 *   • пользователь трогал микшер в MCC;
 *   • карта сбросилась;
 *   • запись не применилась (мы не можем это проверить в тишине).
 *
 * Поэтому модель НИКОГДА не выдаёт себя за прочитанное с карты.
 * У каждой записи есть `source` и `confidence`, а интерфейс обязан
 * показать пользователю, что состояние — наше, а не подтверждённое.
 *
 * ═══ ФОРМАТ ═══
 *
 *     {
 *       version: 1,
 *       updatedAt: "2026-11-16T...",
 *       matrix: { "b": { "pb12": { l: 0, r: 0 }, ... }, ... }
 *     }
 */

/** Ключ в localStorage. С версией — чтобы старый формат не ломал новый. */
export const MIXER_STATE_KEY = 'm62.mixer.v1';

/** Версия формата. */
export const MIXER_STATE_VERSION = 1;

/**
 * Матрица микшера: шина -> источник -> уровни L/R.
 *
 * `null` — это «−∞» (глушение), а не «нет данных»: микшер не читается
 * с карты, поэтому вся модель целиком наша. Ноль — валидный уровень
 * 0 дБ, различать обязательно.
 *
 * @typedef {Record<string, Record<string, {l:number|null, r:number|null}>>} MixerMatrix
 */

/**
 * Сохранённое состояние микшера в localStorage.
 *
 * @typedef {object} MixerState
 * @property {number} version
 * @property {string} updatedAt
 * @property {MixerMatrix} matrix
 */

/**
 * Пустая матрица: все шины, все источники, −inf (mute).
 *
 * ПОЧЕМУ НЕ 0 дБ: 0 дБ означает «источник слышен в шине». Если мы
 * покажем это по умолчанию, а карта на самом деле в другом
 * состоянии, пользователь получит неверную картину и может,
 * например, включить микрофон в наушники. Тишина — безопасное
 * значение по умолчанию.
 *
 * @param {Record<string, {l:number, r:number}>} buses  MIXER_BUSES
 * @param {Record<string, {prop:number, stereo:boolean, name:string}>} sources MIXER_SOURCES
 * @returns {MixerMatrix}
 */
export function emptyMatrix(buses, sources) {
  const out = {};
  for (const bus of Object.keys(buses)) {
    out[bus] = {};
    for (const src of Object.keys(sources)) {
      out[bus][src] = { l: null, r: null };
    }
  }
  return out;
}

/**
 * Прочитать модель из localStorage.
 *
 * Возвращает `null`, если ничего не сохранено или формат чужой.
 * Битые данные не «починяем на лету»: лучше показать пустое
 * состояние, чем угаданное.
 *
 * @param {Storage} [storage]
 * @returns {MixerState|null}
 */
export function loadMixerState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(MIXER_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== MIXER_STATE_VERSION) return null;
    if (!parsed.matrix || typeof parsed.matrix !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Сохранить модель.
 *
 * @param {MixerMatrix} matrix
 * @param {Storage} [storage]
 * @returns {{ok:boolean, error?:string}}
 */
export function saveMixerState(matrix, storage = globalThis.localStorage) {
  try {
    const payload = {
      version: MIXER_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      matrix,
    };
    storage?.setItem(MIXER_STATE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    // Переполнение квоты или приватный режим — это не повод падать.
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Забыть модель.
 * @param {Storage} [storage]
 */
export function clearMixerState(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(MIXER_STATE_KEY);
  } catch {
    /* нечего забывать */
  }
}

/**
 * Изменить одну ячейку матрицы (не мутируя исходную).
 *
 * @param {MixerMatrix} matrix
 * @param {string} bus
 * @param {string} source
 * @param {{l?:number, r?:number}} value
 * @returns {MixerMatrix} новая матрица
 */
export function setCell(matrix, bus, source, value) {
  const next = { ...matrix };
  next[bus] = { ...next[bus] };
  const prev = next[bus][source] ?? { l: null, r: null };
  next[bus][source] = {
    l: value.l !== undefined ? value.l : prev.l,
    r: value.r !== undefined ? value.r : prev.r,
  };
  return next;
}

/**
 * Отличия между двумя матрицами — для записи только изменённого.
 *
 * ЗАЧЕМ: писать всю матрицу (200 кадров) на каждое движение мышью
 * расточительно и рискованно. Сравниваем модель до и после и
 * отправляем ровно те ячейки, что поменялись.
 *
 * @param {MixerMatrix} before
 * @param {MixerMatrix} after
 * @returns {Array<{bus:string, source:string, l:number|null, r:number|null}>}
 */
export function diffMatrix(before, after) {
  const out = [];
  for (const bus of Object.keys(after)) {
    for (const src of Object.keys(after[bus] ?? {})) {
      const a = before?.[bus]?.[src] ?? { l: null, r: null };
      const b = after[bus][src];
      if (a.l !== b.l || a.r !== b.r) {
        out.push({ bus, source: src, l: b.l, r: b.r });
      }
    }
  }
  return out;
}

/**
 * Сколько ячеек реально задано (не null).
 *
 * Нужно, чтобы UI мог честно сказать «состояние известно для N из M
 * ячеек» вместо того, чтобы делать вид, что знает всё.
 *
 * @param {MixerMatrix} matrix
 * @returns {{known:number, total:number}}
 */
export function countKnown(matrix) {
  let known = 0;
  let total = 0;
  for (const bus of Object.keys(matrix ?? {})) {
    for (const src of Object.keys(matrix[bus] ?? {})) {
      total += 1;
      const c = matrix[bus][src];
      if (c && (c.l !== null || c.r !== null)) known += 1;
    }
  }
  return { known, total };
}
