/**
 * LOOPBACK И DUCKING — запись в устройство.
 *
 * ═══ ЧЕМ ЭТОТ МОДУЛЬ ОТЛИЧАЕТСЯ ОТ state-store ═══
 *
 * `state-store.js` хранит значения в файле: микшер, loopback, ducking
 * из устройства не читаются, поэтому их состояние живёт у клиента.
 *
 * Здесь другое — **отправка этих значений в устройство**. До сих пор
 * такой код был только в скриптах-пробах, в бекенде маршрутов не было.
 *
 * ═══ ЧТО ПРОВЕРЕНО ═══
 *
 * `src/tools/probe-duck-loopback-write.js` (2026-11-10): запись
 * принимается и устройство не ломается — поток не прерывается,
 * другие блоки не меняются. И одиночными кадрами, и в брекете.
 *
 * **Чего проверить нельзя:** применилось ли значение. Ducking и
 * loopback не читаются обратно (`IN=0` во всех захватах). Доказать
 * можно только захватом USBPcap с админом или косвенно — по метрам.
 * Пока считаем, что раз устройство не отвергло и не сломалось,
 * запись дошла.
 *
 * ═══ АДРЕСА ═══
 *
 *   DUCKING (0x43)
 *     0x01 Threshold, дБ
 *     0x02 Attack
 *     0x03 Reduction
 *     0x04 Release
 *     0x05 маска входов, младший байт (по битам)
 *     0x06 маска входов, старший байт
 *     0x07 Switch (0/1)
 *
 *   LOOPBACK (4 пары)
 *     0x51/0x52 = LB12, 0x53/0x54 = LB34,
 *     0x55/0x56 = LB56, 0x57/0x58 = LB78
 *     0x02 = код источника (см. SOURCE_CODES в mixer-tags.js)
 *     0x03 = gain в Q25
 *
 * ═══ Q25 ═══
 *
 *  0        = mute
 *  2^25     = 33554432 = 0 дБ
 *  2^24     = 16777216 = −6.02 дБ
 *  +12 дБ   = 133582600
 */

import { SOURCE_CODES } from './mixer-tags.js';

const TT_DUCK = 0x43;
const Q25_UNITY = 33554432;

/** Параметры ducking. */
export const DUCK_FIELDS = {
  threshold: { prop: 0x01, min: -60, max: 0, unit: 'dB' },
  attack: { prop: 0x02, min: 1, max: 500, unit: 'ms' },
  reduction: { prop: 0x03, min: 0, max: 60, unit: 'dB' },
  release: { prop: 0x04, min: 1, max: 3000, unit: 'ms' },
  maskLo: { prop: 0x05, min: 0, max: 255, unit: '' },
  maskHi: { prop: 0x06, min: 0, max: 255, unit: '' },
  switch: { prop: 0x07, min: 0, max: 1, unit: '' },
};

export const DUCK_FIELD_NAMES = Object.keys(DUCK_FIELDS);

/** Пары loopback: имя -> (группа L, группа R). */
export const LOOPBACK_PAIRS = {
  lb12: { l: 0x51, r: 0x52, label: 'Loopback 1/2' },
  lb34: { l: 0x53, r: 0x54, label: 'Loopback 3/4' },
  lb56: { l: 0x55, r: 0x56, label: 'Loopback 5/6' },
  lb78: { l: 0x57, r: 0x58, label: 'Loopback 7/8' },
};

export const LOOPBACK_PAIR_NAMES = Object.keys(LOOPBACK_PAIRS);

/** Имя источника -> код. Обратный поиск по SOURCE_CODES. */
const NAME_TO_CODE = (() => {
  const out = {};
  for (const [id, info] of Object.entries(SOURCE_CODES)) {
    out[id] = info.code;
  }
  // человеческие имена тоже принимаем
  out['IN 1'] = 6;
  out['IN 2'] = 7;
  out['IN 1+2'] = 8;
  out['AUX'] = 9;
  out['BT'] = 10;
  out['OTG IN'] = 11;
  out['Playback 1/2'] = 12;
  out['Playback 3/4'] = 13;
  out['Playback 5/6'] = 14;
  out['Playback 7/8'] = 15;
  out['Playback 9/10'] = 16;
  out['FX'] = 17;
  out['Mix A'] = 1;
  out['Mix B'] = 2;
  out['Mix C'] = 3;
  return out;
})();

/**
 * Код источника по имени или числу.
 * @param {string|number} src
 * @returns {number}
 */
export function sourceCode(src) {
  if (typeof src === 'number') {
    if (Number.isFinite(src) && src >= 0 && src <= 17) return src;
    throw new Error(`код источника вне диапазона 0..17: ${src}`);
  }
  const raw = String(src ?? '').trim();
  if (!raw) throw new Error('источник не указан');
  if (NAME_TO_CODE[raw] !== undefined) return NAME_TO_CODE[raw];
  const lower = Object.keys(NAME_TO_CODE)
    .find((k) => k.toLowerCase() === raw.toLowerCase());
  if (lower !== undefined) return NAME_TO_CODE[lower];
  throw new Error(
    `неизвестный источник: ${raw}; допустимо ${Object.keys(NAME_TO_CODE).join(', ')}`,
  );
}

/** дБ -> Q25. −90 и ниже считаем mute (0). */
export function dbToQ25(db) {
  const n = Number(db);
  if (!Number.isFinite(n)) throw new Error(`gain: ожидалось число, получили "${db}"`);
  if (n <= -90) return 0;
  return Math.round(Q25_UNITY * 10 ** (n / 20));
}

/** Q25 -> дБ. 0 даёт −Infinity (mute). */
export function q25ToDb(q) {
  if (q === 0) return -Infinity;
  return 20 * Math.log10(q / Q25_UNITY);
}

/** Проверка значения ducking. */
export function validateDuckValue(field, value) {
  const f = DUCK_FIELDS[field];
  if (!f) {
    throw new Error(`неизвестный параметр ducking: ${field}; допустимо ${DUCK_FIELD_NAMES.join(', ')}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field}: ожидалось число, получили "${value}"`);
  if (n < f.min || n > f.max) {
    throw new Error(`${field}: значение ${n} вне диапазона ${f.min}..${f.max}${f.unit ? ' ' + f.unit : ''}`);
  }
  return Math.round(n);
}

/**
 * Кадры для набора параметров ducking.
 * @param {Record<string, number>} values
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildDuckingFrames(values) {
  const frames = [];
  for (const [field, value] of Object.entries(values ?? {})) {
    const v = validateDuckValue(field, value);
    frames.push({ target: TT_DUCK, prop: DUCK_FIELDS[field].prop, value: v });
  }
  if (!frames.length) throw new Error('buildDuckingFrames: пустой набор');
  return frames;
}

/**
 * Кадры для одной пары loopback.
 *
 * Источник пишется в ЛЕВУЮ группу пары (0x02), gain — в обе
 * (0x03), потому что пара стереофоническая.
 *
 * @param {string} pair  'lb12' | 'lb34' | 'lb56' | 'lb78'
 * @param {{source?: string|number, gainDb?: number}} opts
 */
export function buildLoopbackFrames(pair, opts = {}) {
  const p = LOOPBACK_PAIRS[pair];
  if (!p) {
    throw new Error(`неизвестная пара loopback: ${pair}; допустимо ${LOOPBACK_PAIR_NAMES.join(', ')}`);
  }
  const frames = [];

  if (opts.source !== undefined && opts.source !== null) {
    const code = sourceCode(opts.source);
    frames.push({ target: p.l, prop: 0x02, value: code });
  }

  if (opts.gainDb !== undefined && opts.gainDb !== null) {
    const q = dbToQ25(opts.gainDb);
    frames.push({ target: p.l, prop: 0x03, value: q });
    frames.push({ target: p.r, prop: 0x03, value: q });
  }

  if (!frames.length) {
    throw new Error('buildLoopbackFrames: нечего писать (нужен source и/или gainDb)');
  }
  return frames;
}

/**
 * Кадры для нескольких пар сразу.
 * @param {Record<string, {source?: any, gainDb?: number}>} pairs
 */
export function buildAllLoopbackFrames(pairs) {
  const out = [];
  for (const [name, opts] of Object.entries(pairs ?? {})) {
    out.push(...buildLoopbackFrames(name, opts));
  }
  if (!out.length) throw new Error('buildAllLoopbackFrames: пустой набор');
  return out;
}

/** Описание для API. */
export function describeDuckingLoopback() {
  return {
    ducking: {
      fields: DUCK_FIELD_NAMES,
      limits: Object.fromEntries(
        Object.entries(DUCK_FIELDS).map(([k, f]) => [k, { min: f.min, max: f.max, unit: f.unit }]),
      ),
      addresses: Object.fromEntries(
        Object.entries(DUCK_FIELDS).map(([k, f]) => [k, `0x43:0x${f.prop.toString(16).padStart(2, '0')}`]),
      ),
    },
    loopback: {
      pairs: Object.fromEntries(
        Object.entries(LOOPBACK_PAIRS).map(([k, p]) => [k, {
          label: p.label,
          l: `0x${p.l.toString(16)}`,
          r: `0x${p.r.toString(16)}`,
        }]),
      ),
      sourceCodes: Object.fromEntries(
        Object.entries(SOURCE_CODES).map(([k, v]) => [k, v.code]),
      ),
    },
    scale: {
      kind: 'Q25',
      unity: Q25_UNITY,
      halfDb: -6.02,
      mute: 0,
      note: 'gain −90 дБ и ниже пишется как 0 (mute)',
    },
    caveat: 'Ducking и loopback не читаются из устройства. Запись принимается, '
      + 'но подтвердить применение можно только захватом USBPcap.',
  };
}
