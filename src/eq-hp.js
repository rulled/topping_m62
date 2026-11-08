/**
 * EQ НАУШНИКОВ (0xa1..0xaa) — чтение и запись.
 *
 * ═══ ТОЛЬКО В PROF-РЕЖИМЕ ═══
 *
 * Блоки 0xa1..0xaa существуют ТОЛЬКО в Pro audio mode. В Live и Mobile
 * их нет вообще — проверено дампами всех трёх режимов.
 *
 * ═══ ТАЙМИНГ (критично!) ═══
 *
 * В Prof-режиме эти блоки приходят на 7–11 секунде после подписки
 * (в Live EQ приходил на 4.5 с). Поэтому:
 *
 *     пауза между сессиями:   >= 5 с
 *     окно прослушивания:     >= 26 с
 *
 * Если снимок короче, блоки не попадут в него, и будет ЛОЖНОЕ ощущение,
 * что запись не применилась (тег придёт как undefined, а не старым).
 *
 * ═══ СТРУКТУРА ═══
 *
 *     0xa1 = полоса 1  ...  0xaa = полоса 10
 *     свойства 01..05 = ЛЕВЫЙ канал
 *     свойства 06..0a = ПРАВЫЙ канал
 *
 *         01 / 06  вкл-выкл полосы      0/1
 *         02 / 07  тип фильтра          1 = peaking
 *         03 / 08  gain, дБ
 *         04 / 09  частота, Гц
 *         05 / 0a  Q × 10000
 *
 * Структура идентична EQ входов (0x91..0x94), разница только в количестве
 * блоков: 4 против 10.
 *
 * ═══ ЗАПИСЬ РАБОТАЕТ ═══
 *
 * Проверено контрольным опытом: прямая запись send(0xa1, 0x03, 30)
 * применяется и видна в следующем снимке. Брекет bulk push не нужен
 * (в отличие от микшера).
 */

/** Первый блок EQ наушников. */
export const EQ_HP_FIRST = 0xa1;
/** Последний блок (10 полос). */
export const EQ_HP_LAST = 0xaa;
/** Сколько полос. */
export const EQ_HP_BANDS = 10;

/** Поля полосы: имя -> смещение в блоке. */
export const EQ_HP_FIELDS = {
  enable: 0x01,
  type: 0x02,
  gain: 0x03,
  freq: 0x04,
  q: 0x05,
};

/** Смещение для правого канала (L + 5). */
export const EQ_HP_RIGHT_OFFSET = 5;

/**
 * Смещение усиления на выходе (тег 0xab:0x0f?).
 * Не подтверждено — оставлено для будущего.
 */
export const EQ_HP_GAIN_OUTPUT = { target: 0xab, prop: 0x0f };

/**
 * Проверяет, что блок относится к EQ наушников.
 * @param {number} target
 * @returns {boolean}
 */
export function isEqHpBlock(target) {
  return target >= EQ_HP_FIRST && target <= EQ_HP_LAST;
}

/**
 * Номер полосы по блоку (1..10) или null.
 * @param {number} target
 * @returns {number|null}
 */
export function bandOf(target) {
  if (!isEqHpBlock(target)) return null;
  return target - EQ_HP_FIRST + 1;
}

/**
 * Собирает параметры полосы из снимка состояния.
 *
 * @param {Map<string, number>|Record<string, number>} state
 *        Ключи могут быть в ДВУХ форматах:
 *          "161:3"   десятичный (так пишет transport.snapshot())
 *          "a1:03"   hex       (так пишут наши скрипты и дампы)
 *        Пробуем оба.
 * @param {number} band  1..10
 * @returns {{band:number, l:object, r:object}}
 */
export function readBand(state, band) {
  const get = (tt, pp) => {
    const hexKey = `${tt.toString(16).padStart(2, '0')}:${pp.toString(16).padStart(2, '0')}`;
    const decKey = `${tt}:${pp}`;
    if (state instanceof Map) {
      const v = state.get(hexKey);
      if (v !== undefined) return v;
      return state.get(decKey);
    }
    if (state[hexKey] !== undefined) return state[hexKey];
    return state[decKey];
  };

  const tt = EQ_HP_FIRST + band - 1;
  const mk = (offset) => ({
    enable: get(tt, EQ_HP_FIELDS.enable + offset),
    type: get(tt, EQ_HP_FIELDS.type + offset),
    gain: get(tt, EQ_HP_FIELDS.gain + offset),
    freq: get(tt, EQ_HP_FIELDS.freq + offset),
    q: get(tt, EQ_HP_FIELDS.q + offset),
  });

  return { band, l: mk(0), r: mk(EQ_HP_RIGHT_OFFSET) };
}

/**
 * Все 10 полос сразу.
 * @param {Map<string, number>|Record<string, number>} state
 * @returns {Array}
 */
export function readAllBands(state) {
  const out = [];
  for (let b = 1; b <= EQ_HP_BANDS; b += 1) out.push(readBand(state, b));
  return out;
}

/**
 * Готовит кадры для записи одной полосы.
 *
 * @param {number} band  1..10
 * @param {{l?:object, r?:object}} params
 *        { l: { enable, type, gain, freq, q }, r: {...} }
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildBandFrames(band, params) {
  if (band < 1 || band > EQ_HP_BANDS) {
    throw new Error(`полоса вне диапазона 1..${EQ_HP_BANDS}: ${band}`);
  }
  const tt = EQ_HP_FIRST + band - 1;
  const frames = [];

  const push = (offset, obj) => {
    if (!obj) return;
    for (const [name, prop] of Object.entries(EQ_HP_FIELDS)) {
      if (obj[name] === undefined) continue;
      frames.push({ target: tt, prop: prop + offset, value: obj[name] });
    }
  };

  push(0, params.l);
  push(EQ_HP_RIGHT_OFFSET, params.r);
  return frames;
}

/**
 * Описание для API.
 * @returns {object}
 */
export function describeEqHp() {
  return {
    availableInModes: ['Prof'],
    bandCount: EQ_HP_BANDS,
    firstBlock: `0x${EQ_HP_FIRST.toString(16)}`,
    lastBlock: `0x${EQ_HP_LAST.toString(16)}`,
    channels: ['L', 'R'],
    fields: {
      enable: { prop: '0x01 / 0x06', kind: 'bool', note: '0 = выкл, 1 = вкл' },
      type: { prop: '0x02 / 0x07', kind: 'enum', note: '1 = peaking' },
      gain: { prop: '0x03 / 0x08', kind: 'int', unit: 'дБ' },
      freq: { prop: '0x04 / 0x09', kind: 'int', unit: 'Гц' },
      q: { prop: '0x05 / 0x0a', kind: 'int', note: 'Q × 10000' },
    },
    timing: {
      warn: 'в Prof блоки приходят на 7-11 с',
      sessionGapMs: 5000,
      snapshotWindowMs: 26000,
    },
    write: {
      works: true,
      needsBulkPush: false,
      note: 'прямая запись send(0xa1, 0x03, value) применяется',
    },
  };
}
