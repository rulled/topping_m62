/**
 * EQ ВХОДОВ ЧЕРЕЗ HID — чтение и запись без M Control Center.
 *
 * ═══ ЧТО ЭТО ЗАМЕНЯЕТ ═══
 *
 * Раньше `src/eq-control.js` открывал окно EQ в MCC и двигал дилы
 * клавишами через UIAutomation. Это требовало запущенного MCC
 * и падало без него.
 *
 * Проверено 2026-11-10 на живом устройстве (MCC закрыт):
 * все пять полей полосы пишутся ПРЯМОЙ записью в HID:
 *
 *   вкл полосы 1       0x91:01   0 -> 1      принято
 *   тип полосы 1       0x91:02   1 -> 2      принято
 *   gain полосы 1      0x91:03   0 -> 3      принято
 *   частота полосы 1   0x91:04   632 -> 1000 принято
 *   Q полосы 1         0x91:05   7000 -> 10000 принято
 *   gain полосы 2      0x91:08   0 -> 2      принято
 *   gain канала 2      0x93:03   0 -> 2      принято
 *
 * Все значения проверены в НОВОЙ сессии (переподключение), откат ОК.
 * Инструмент: `src/tools/eq-write-all-fields.js`.
 *
 * ═══ РАСКЛАДКА ═══
 *
 *   блок 0x91 = канал 1, полосы 1-2
 *   блок 0x92 = канал 1, полосы 3-4
 *   блок 0x93 = канал 2, полосы 1-2
 *   блок 0x94 = канал 2, полосы 3-4
 *
 * Внутри блока 10 свойств, две полосы по пять:
 *
 *   полоса A: 0x01 вкл / 0x02 тип / 0x03 gain / 0x04 частота / 0x05 Q
 *   полоса B: 0x06 вкл / 0x07 тип / 0x08 gain / 0x09 частота / 0x0a Q
 *
 * Итого 4 блока x 2 полосы x 5 полей = 40 параметров.
 *
 * ═══ ВАЖНОЕ ПРАВИЛО ИЗМЕРЕНИЯ ═══
 *
 * Устройство отдаёт блоки 0x91..0x94 ТОЛЬКО на первый ANNOUNCE
 * в сессии. Повторный announce в той же сессии EQ не возвращает
 * (проверено: 101 тег на первом, 46 на втором).
 *
 * Поэтому читать «после записи» надо в НОВОЙ сессии, иначе результат
 * будет пустым и его легко принять за отказ устройства.
 *
 * ═══ ЕДИНИЦЫ ═══
 *
 *   gain     — дБ, -12..+12
 *   freq     — Гц, 20..20000
 *   Q        — передаётся как Q x 10000 (0.7 -> 7000)
 *   тип      — 1 = peaking (дефолт)
 *   вкл      — 0/1
 */

/** Первый блок каждого канала. */
const CHANNEL_BASE = { IN1: 0x91, IN2: 0x93 };

/** Смещение полосы внутри блока: полоса 1 и 3 -> 0x00, полоса 2 и 4 -> 0x05. */
const BAND_OFFSET = [0x00, 0x05, 0x00, 0x05];

/** Поле -> свойство внутри полосы. */
const FIELD_PROP = { enable: 0x01, type: 0x02, gain: 0x03, freq: 0x04, q: 0x05 };

/**
 * КОДЫ ТИПОВ ФИЛЬТРОВ В УСТРОЙСТВЕ.
 *
 * ═══ ЛОВУШКА ═══
 *
 * `EQ_LAYOUT.filterTypes` — это массив для UI:
 *
 *     ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf']
 *        0           1          2           3           4
 *
 * Но устройство НЕ использует индекс массива. Проверено на живом
 * устройстве 2026-11-10: у полосы в состоянии по умолчанию
 * `0x91:0x02 = 1`, и это именно peaking (в MCC подписано «peaking»,
 * остальные полосы тоже 1).
 *
 * То есть коды в устройстве СДВИНУТЫ на единицу относительно
 * индексов массива:
 *
 *     peaking    = 1
 *     lowpass    = 2
 *     highpass   = 3
 *     lowshelf   = 4
 *     highshelf  = 5
 *
 * 0 в устройстве означает «тип не задан» и на практике не встречается.
 *
 * Если отправлять индекс массива напрямую (как было сначала), peaking
 * превращается в 0 и полоса теряет тип. На этом я уже ошибся —
 * исправлено.
 */
export const DEVICE_TYPE_CODE = {
  peaking: 1,
  lowpass: 2,
  highpass: 3,
  lowshelf: 4,
  highshelf: 5,
};

/** Обратный поиск: код устройства -> имя типа. */
export const TYPE_BY_DEVICE_CODE = Object.fromEntries(
  Object.entries(DEVICE_TYPE_CODE).map(([name, code]) => [code, name]),
);

/** Границы значений. */
export const EQ_LIMITS = {
  gain: { min: -12, max: 12, unit: 'dB' },
  freq: { min: 20, max: 20000, unit: 'Hz' },
  q: { min: 0.05, max: 20, unit: '' },
  type: { min: 1, max: 5, unit: '' },
  enable: { min: 0, max: 1, unit: '' },
};

export const EQ_BANDS = 4;
export const EQ_FIELD_NAMES = Object.keys(FIELD_PROP);

/**
 * Адрес тега для поля полосы.
 * @param {'IN1'|'IN2'} channel
 * @param {number} band  1..4
 * @param {'enable'|'type'|'gain'|'freq'|'q'} field
 * @returns {{target: number, prop: number}}
 */
export function eqTagAddress(channel, band, field) {
  const base = CHANNEL_BASE[channel];
  if (base === undefined) throw new Error(`неизвестный канал: ${channel}; допустимо IN1, IN2`);
  if (!Number.isInteger(band) || band < 1 || band > EQ_BANDS) {
    throw new Error(`band должен быть 1..${EQ_BANDS}`);
  }
  const prop = FIELD_PROP[field];
  if (prop === undefined) {
    throw new Error(`неизвестное поле: ${field}; допустимо ${EQ_FIELD_NAMES.join(', ')}`);
  }
  // Полоса 1 и 2 — первый блок канала (0x91/0x93),
  // полоса 3 и 4 — следующий (0x92/0x94).
  const blockOffset = band >= 3 ? 1 : 0;
  return {
    target: base + blockOffset,
    prop: BAND_OFFSET[band - 1] + prop,
  };
}

/**
 * Приводит значение к тому виду, в котором его ждёт устройство.
 * Q умножается на 10000, остальное передаётся как есть.
 */
function toDevice(field, value) {
  if (field === 'q') return Math.round(value * 10000);
  if (field === 'gain') return Math.round(value);
  if (field === 'freq') return Math.round(value);
  return Math.round(value);
}

/** Обратное преобразование: из устройства в человеческие единицы. */
export function fromDevice(field, raw) {
  if (raw === null || raw === undefined) return null;
  if (field === 'q') return raw / 10000;
  return raw;
}

/** Проверяет значение по границам, бросает с внятным текстом. */
export function validateEqValue(field, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field}: ожидалось число, получили "${value}"`);
  const lim = EQ_LIMITS[field];
  if (!lim) throw new Error(`неизвестное поле: ${field}`);
  if (n < lim.min || n > lim.max) {
    throw new Error(`${field}: значение ${n} вне диапазона ${lim.min}..${lim.max}${lim.unit ? ' ' + lim.unit : ''}`);
  }
  return n;
}

/**
 * Собирает кадры для установки одного поля полосы.
 * @returns {Array<{target: number, prop: number, value: number}>}
 */
export function buildEqFrames(channel, band, field, value) {
  const v = validateEqValue(field, value);
  const addr = eqTagAddress(channel, band, field);
  return [{ target: addr.target, prop: addr.prop, value: toDevice(field, v) }];
}

/**
 * Читает все полосы канала из снимка состояния.
 *
 * Ключи снимка бывают в двух форматах: hex ("91:03", как пишут наши
 * скрипты) и decimal ("145:3", как пишет transport). Поддерживаем оба,
 * иначе половина тегов теряется — на этой путанице проект уже
 * спотыкался дважды.
 *
 * @param {Map<string, number>|Record<string, number>} snapshot
 * @param {'IN1'|'IN2'} channel
 * @returns {Array<{band: number, enable: ?number, type: ?number, gain: ?number, freq: ?number, q: ?number}>}
 */
export function readChannelBands(snapshot, channel) {
  const get = (target, prop) => {
    if (snapshot instanceof Map) {
      for (const [k, v] of snapshot) {
        const [a, b] = String(k).split(':');
        if (a === undefined || b === undefined) continue;
        const ta = parseInt(a, 16);
        const tb = parseInt(b, 16);
        const taDec = Number(a);
        const tbDec = Number(b);
        if ((ta === target || taDec === target) && (tb === prop || tbDec === prop)) return v;
      }
      return null;
    }
    // объект
    const hexKey = `${target.toString(16).padStart(2, '0')}:${prop.toString(16).padStart(2, '0')}`;
    if (snapshot[hexKey] !== undefined) return snapshot[hexKey];
    const decKey = `${target}:${prop}`;
    if (snapshot[decKey] !== undefined) return snapshot[decKey];
    return null;
  };

  const out = [];
  for (let band = 1; band <= EQ_BANDS; band += 1) {
    const row = { band };
    for (const field of EQ_FIELD_NAMES) {
      const addr = eqTagAddress(channel, band, field);
      const raw = get(addr.target, addr.prop);
      row[field] = fromDevice(field, raw);
      // Тип дублируем человеческим именем — фронту не нужно
      // держать таблицу кодов у себя.
      if (field === 'type') {
        row.typeName = row.type === null || row.type === undefined
          ? null
          : (TYPE_BY_DEVICE_CODE[row.type] ?? null);
      }
    }
    out.push(row);
  }
  return out;
}

/** Описание для API и фронтенда. */
export function describeEqHid() {
  return {
    channels: Object.keys(CHANNEL_BASE),
    bands: EQ_BANDS,
    fields: EQ_FIELD_NAMES,
    limits: EQ_LIMITS,
    addressing: {
      IN1: { bands12: '0x91', bands34: '0x92' },
      IN2: { bands12: '0x93', bands34: '0x94' },
      bandFields: {
        first: { enable: '0x01', type: '0x02', gain: '0x03', freq: '0x04', q: '0x05' },
        second: { enable: '0x06', type: '0x07', gain: '0x08', freq: '0x09', q: '0x0a' },
      },
    },
    totalParameters: EQ_BANDS * 2 * EQ_FIELD_NAMES.length * 2,
    note: 'Q передаётся как Q x 10000. Читать «после записи» нужно в НОВОЙ сессии: '
      + 'устройство отдаёт 0x91..0x94 только на первый ANNOUNCE сессии.',
  };
}
