/**
 * МИКШЕР M62 — ПОЛНАЯ КАРТА (расшифровано из USBPcap).
 *
 * ═══ ОТКУДА ЭТО ═══
 *
 * Три прогона захвата с уникальными значениями в workspace-INI
 * (2026-11-08). Каждому источнику присваивалось своё усиление, затем
 * MCC при старте отправлял всё состояние одним bulk push, и по
 * значению определялся источник.
 *
 * ═══ СТРУКТУРА ═══
 *
 * Микшер пишется ТОЛЬКО внутри брекера:
 *
 *     0x11:0x20 = 1     открыть bulk push
 *     ... 242 кадра ...
 *     0x11:0x20 = 0     закрыть
 *     0x11:0x26 = 1     запросить дамп обратно
 *
 * Одиночные записи в 0x31..0x3c НЕ РАБОТАЮТ — проверено.
 *
 * Группа (TT) = один микс, L или R:
 *
 *     0x31/0x32 = Mix A L/R    0x33/0x34 = Mix B L/R
 *     0x35/0x36 = Mix C L/R    0x37/0x38 = Mix D L/R
 *     0x3b/0x3c = Mix E L/R
 *
 * Свойство (PP) = источник, значение = Q25.
 *
 * ═══ ПРОВЕРКА ═══
 *
 * Карта подтверждена перекрёстно: AUX и BT видны и в Mix B, и в Mix C,
 * и попали в ОДНИ И ТЕ ЖЕ свойства. Значения квантуются с ошибкой ±1 Q25,
 * поэтому сравнивать надо с допуском, а не точно.
 */

/** Unity в Q25: 2^25 = 0 дБ. */
export const Q25_UNITY = 33554432;

/** Половина unity: 2^24 = −6.02 дБ. Базовое ослабление моно-входов. */
export const Q25_HALF = 16777216;

/**
 * Источники микшера: имя -> базовое свойство.
 * Для стерео: L = base, R = base + 1.
 * Для моно (in1, in2): одно свойство, пишется в оба канала.
 */
export const MIXER_SOURCES = {
  pb12: { prop: 0x01, stereo: true, name: 'Playback 1/2' },
  pb34: { prop: 0x03, stereo: true, name: 'Playback 3/4' },
  pb56: { prop: 0x05, stereo: true, name: 'Playback 5/6' },
  pb78: { prop: 0x07, stereo: true, name: 'Playback 7/8' },
  in1: { prop: 0x09, stereo: false, name: 'IN 1' },
  in2: { prop: 0x0a, stereo: false, name: 'IN 2' },
  aux: { prop: 0x0b, stereo: true, name: 'AUX' },
  otgin: { prop: 0x0d, stereo: true, name: 'OTG IN' },
  bt: { prop: 0x0f, stereo: true, name: 'BT' },
  pb910: { prop: 0x11, stereo: true, name: 'Playback 9/10' },
  fx: { prop: 0x13, stereo: true, name: 'FX' },
};

/**
 * Микшер-шины: имя -> пара групп L/R.
 */
export const MIXER_BUSES = {
  a: { l: 0x31, r: 0x32 },
  b: { l: 0x33, r: 0x34 },
  c: { l: 0x35, r: 0x36 },
  d: { l: 0x37, r: 0x38 },
  e: { l: 0x3b, r: 0x3c },
};

/**
 * Все 20 свойств в ТОМ ПОРЯДКЕ, как их реально шлёт MCC.
 *
 * ВАЖНО: измерено из захвата (research/m62-full.pcap, dump-sequence.py):
 *
 *     09 0a 0b 0c 0f 10 0d 0e 13 14 01 02 03 04 05 06 07 08 11 12
 *
 * Разбито на 10 блоков по 2 — это стерео-пары источников.
 */
export const MIXER_PROPS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0f, 0x10, 0x0d, 0x0e, 0x13, 0x14,
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x11, 0x12,
];

/**
 * Блоки свойств — по два на источник (стерео-пара).
 * Моно-источники (IN1, IN2) занимают блок целиком: 0x09 и 0x0a —
 * это два РАЗНЫХ моно-входа, но шлются они одним блоком.
 */
export const MIXER_BLOCKS = [
  [0x09, 0x0a],
  [0x0b, 0x0c],
  [0x0f, 0x10],
  [0x0d, 0x0e],
  [0x13, 0x14],
  [0x01, 0x02],
  [0x03, 0x04],
  [0x05, 0x06],
  [0x07, 0x08],
  [0x11, 0x12],
];

/**
 * Порядок групп, как их реально шлёт MCC.
 *
 * ВАЖНО: MCC начинает с 0x33 (Mix B), а не с 0x31 (Mix A).
 */
export const MIXER_GROUP_ORDER = [
  0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x3b, 0x3c, 0x31, 0x32,
];

/**
 * Переводит дБ в Q25.
 * @param {number} db
 * @returns {number}
 */
export function dbToQ25(db) {
  if (db <= -90) return 0; // mute
  return Math.round(Math.pow(10, db / 20) * Q25_UNITY);
}

/**
 * Переводит Q25 в дБ.
 * @param {number} value
 * @returns {number} дБ, -Infinity для 0
 */
export function q25ToDb(value) {
  if (!value) return -Infinity;
  return 20 * Math.log10(value / Q25_UNITY);
}

/**
 * Собирает полный пакет матрицы для bulk push.
 *
 * @param {Record<string, {l?: number, r?: number}>} state
 *        состояние в дБ: { busName: { sourceName: db } }
 *        например { b: { in1: -6, pb12: 0 } }
 * @returns {Array<{target: number, prop: number, value: number}>}
 */
/**
 * Значение свойства для источника в данной шине.
 * @param {number} prop
 * @param {Record<string, number>} gains  источник -> дБ
 * @returns {number} Q25
 */
function propValue(prop, gains) {
  for (const [srcName, src] of Object.entries(MIXER_SOURCES)) {
    if (src.stereo) {
      if (src.prop === prop) return dbToQ25(gains[srcName] ?? -Infinity);
      if (src.prop + 1 === prop) {
        return dbToQ25(gains[`${srcName}r`] ?? gains[srcName] ?? -Infinity);
      }
    } else if (src.prop === prop) {
      // моно: одно значение идёт в оба канала
      return dbToQ25(gains[srcName] ?? -Infinity);
    }
  }
  return 0;
}

/**
 * Собирает пакет матрицы в ТОЧНОМ порядке MCC.
 *
 * Структура (выведена из research/m62-full.pcap, 200 кадров):
 *
 *     для каждого БЛОКА свойств (MIXER_BLOCKS):
 *         для каждой ГРУППЫ (MIXER_GROUP_ORDER):
 *             для каждого свойства ВНУТРИ блока (2 штуки):
 *                 кадр(группа, свойство)
 *
 * Пример первых 8 кадров эталона:
 *     0x33:09  0x33:0a    0x34:09  0x34:0a
 *     0x35:09  0x35:0a    0x36:09  0x36:0a
 *
 * То есть группа держится два кадра подряд (пара свойств блока),
 * потом следующая группа, и только пройдя все 10 групп — следующий блок.
 *
 * ВАЖЕН ИМЕННО ЭТОТ ПОРЯДОК: первые две версии (группа за группой, затем
 * свойство за свойством) расходились с MCC на 180 позициях из 200.
 *
 * @param {Record<string, Record<string, number>>} state
 *        { busName: { sourceName: db } }, busName из 'a'..'e'
 * @returns {Array<{target: number, prop: number, value: number}>}
 */
export function buildMixerPacket(state) {
  const groupToBus = new Map();
  for (const [busName, bus] of Object.entries(MIXER_BUSES)) {
    groupToBus.set(bus.l, busName);
    groupToBus.set(bus.r, busName);
  }

  const out = [];
  for (const block of MIXER_BLOCKS) {
    for (const group of MIXER_GROUP_ORDER) {
      const busName = groupToBus.get(group);
      const gains = state[busName] ?? {};
      for (const prop of block) {
        out.push({ target: group, prop, value: propValue(prop, gains) });
      }
    }
  }
  return out;
}

/**
 * Пакет для одной шины в том же порядке.
 * @param {string} busName  'a'..'e'
 * @param {Record<string, number>} gains  источник -> дБ
 * @returns {Array<{target: number, prop: number, value: number}>}
 */
export function buildBusPacket(busName, gains) {
  const bus = MIXER_BUSES[busName];
  if (!bus) throw new Error(`неизвестная шина: ${busName}`);

  const out = [];
  for (const block of MIXER_BLOCKS) {
    for (const prop of block) {
      const value = propValue(prop, gains);
      out.push({ target: bus.l, prop, value });
      out.push({ target: bus.r, prop, value });
    }
  }
  return out;
}

/**
 * ИСТОЧНИКИ ВЫХОДОВ И LOOPBACK — полная таблица код -> имя.
 *
 * ═══ ОТКУДА ЭТО ═══
 *
 * Не выведено из последовательности, а взято из mainline-патча
 * drivers/hid/hid-topping-m62.c (`topping_sources[]` +
 * `topping_source_value[]`). Патч — ровно наше устройство:
 * USB_VENDOR_ID_TOPPING 0x152a, USB_DEVICE_ID_TOPPING_M62 0x875c.
 * Таблица встречается в двух независимых копиях патча (v7-1 и lore-p2).
 *
 * Совпадает с `src/controls.js` (SOURCES), который был взят оттуда же.
 *
 * ═══ ДЫРА НА 4 И 5 — ГЛАВНОЕ ═══
 *
 * Комментарий патча дословно:
 *
 *     The same numbering serves the outputs and the loopback returns,
 *     and it has a hole where 4 and 5 would be, so the index of a
 *     control item is not the value the card wants and the two are
 *     kept side by side.
 *
 * То есть кодов 4 и 5 НЕ СУЩЕСТВУЕТ. Раньше здесь стояли
 * `mixD: 4` и `mixE: 5` — это была ошибка. Mix D и Mix E — это
 * ШИНЫ МИКШЕРА (0x37/0x38 и 0x3b/0x3c), а не источники: выбрать их
 * на выход или в loopback нельзя.
 *
 * ═══ ПОЧЕМУ У СЕЛЕКТОРОВ ЕСТЬ «Unknown» ═══
 *
 * Патч: «the device NEVER reports a selector ... which pushes its whole
 * workspace on connect rather than asking». Устройство не сообщает,
 * куда указывает выход, поэтому 0 = «неизвестно, никто не выбирал».
 *
 * ═══ ВСЕ 16 КОДОВ ПОДТВЕРЖДЕНЫ НА ЖЕЛЕЗЕ (2026-11-08) ═══
 *
 * Один захват `research/source-codes.pcap`: в Prof-INI расставили шесть
 * не встречавшихся имён по шести слотам с полем AudioSource, MCC при
 * старте отправил их в устройство — и все шесть кодов совпали:
 *
 *     0x51:0x02 =  2   Mix B
 *     0x53:0x02 =  3   Mix C
 *     0x55:0x02 =  8   IN 1+2
 *     0x57:0x02 = 11   OTG IN
 *     0x64:0x02 = 14   Playback 5/6
 *     0x62:0x02 = 15   Playback 7/8
 *
 * Расхождений 0. Вместе с ранее известными (1, 6, 7, 9, 10, 12, 13, 16, 17)
 * это закрывает все существующие коды.
 */
export const OUTPUT_SOURCES = [
  { code: 0, name: 'Unknown', note: 'не выбор: устройство не сообщает селектор' },
  { code: 1, name: 'Mix A' },
  { code: 2, name: 'Mix B' },
  { code: 3, name: 'Mix C' },
  // 4, 5 — дыра, таких кодов нет
  { code: 6, name: 'IN 1' },
  { code: 7, name: 'IN 2' },
  { code: 8, name: 'IN 1+2' },
  { code: 9, name: 'AUX' },
  { code: 10, name: 'BT' },
  { code: 11, name: 'OTG IN' },
  { code: 12, name: 'Playback 1/2' },
  { code: 13, name: 'Playback 3/4' },
  { code: 14, name: 'Playback 5/6' },
  { code: 15, name: 'Playback 7/8' },
  { code: 16, name: 'Playback 9/10' },
  { code: 17, name: 'FX', note: 'сверх таблицы драйвера: проверено нами на живом устройстве' },
];

/**
 * КОДЫ ДЛЯ ИСТОЧНИКОВ МИКШЕРА — id из MIXER_SOURCES -> код селектора.
 *
 * Это подмножество OUTPUT_SOURCES: какой код поставить, если источник
 * микшера надо назвать как источник выхода (для UI и loopback).
 *
 * `verified` — все true: значения сверены с живыми захватами
 * (`research/source-codes.pcap`, `m62-full.pcap`, `mixer-sources.pcap`).
 *
 * ⚠️ Шин Mix D / Mix E здесь нет и быть не может: в пространстве
 * селекторов им соответствуют несуществующие коды 4 и 5 (дыра).
 * Они — шины микшера (0x37/0x38, 0x3b/0x3c), а не источники.
 */
export const SOURCE_CODES = {
  in1: { code: 6, verified: true },
  in2: { code: 7, verified: true },
  aux: { code: 9, verified: true },
  bt: { code: 10, verified: true },
  otgin: { code: 11, verified: true },
  pb12: { code: 12, verified: true },
  pb34: { code: 13, verified: true },
  pb56: { code: 14, verified: true },
  pb78: { code: 15, verified: true },
  pb910: { code: 16, verified: true },
  fx: { code: 17, verified: true },
};

/** Код -> имя источника выхода. */
export function outputSourceName(code) {
  return OUTPUT_SOURCES.find((s) => s.code === code)?.name ?? null;
}

/**
 * Обратный поиск: код -> имя источника.
 * @param {number} code
 * @returns {string|null}
 */
export function sourceNameByCode(code) {
  for (const [name, info] of Object.entries(SOURCE_CODES)) {
    if (info.code === code) return name;
  }
  return null;
}

/**
 * Описание микшера для API и фронтенда.
 * @returns {object}
 */
export function describeMixer() {
  const sources = Object.entries(MIXER_SOURCES).map(([id, s]) => ({
    id,
    name: s.name,
    prop: s.prop,
    propHex: `0x${s.prop.toString(16).padStart(2, '0')}`,
    stereo: s.stereo,
    propR: s.stereo ? s.prop + 1 : null,
    code: SOURCE_CODES[id]?.code ?? null,
    codeVerified: SOURCE_CODES[id]?.verified ?? false,
  }));

  const buses = Object.entries(MIXER_BUSES).map(([id, b]) => ({
    id,
    name: `Mix ${id.toUpperCase()}`,
    l: b.l,
    r: b.r,
    lHex: `0x${b.l.toString(16)}`,
    rHex: `0x${b.r.toString(16)}`,
  }));

  return {
    sources,
    buses,
    blocks: MIXER_BLOCKS,
    groupOrder: MIXER_GROUP_ORDER,
    outputSources: OUTPUT_SOURCES,
    scale: {
      kind: 'Q25',
      unity: Q25_UNITY,
      half: Q25_HALF,
      unityDb: 0,
      halfDb: -6.02,
      mute: 0,
    },
    // важное для клиента
    notes: [
      'Микшер пишется ТОЛЬКО пакетом внутри bulk push (0x11:0x20 = 1 ... 0)',
      'Одиночные записи в 0x31..0x3c устройство игнорирует',
      'Микшер НЕ читается обратно — храните состояние у себя',
      'MCC при старте перезаписывает микшер своей матрицей из workspace-INI',
      'Порядок кадров критичен: блок -> группа -> свойство внутри блока',
    ],
  };
}
