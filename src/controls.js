/**
 * Описание контролов M62 и кривых громкости.
 *
 * Источник: drivers/hid/hid-topping-m62.c (mainline),
 *          sound/usb/mixer_topping.c
 *
 * ВАЖНО: диапазоны РАЗНЫЕ. Mic-1/Mic-2: 0..88, остальные: 0..99.
 * Индекс 0 всегда mute, максимум — максимум.
 */

/** Кривая: линейная, шаг 1.00 dB. */
export const TLV_GAIN = { kind: 'gain' };

/**
 * Тип A: 3 сегмента.
 *   0       MUTE
 *   1..19   от -88.00 dB, шаг 2.00
 *   20..61  от -51.00 dB, шаг 1.00
 *   62..99  от  -9.50 dB, шаг 0.50
 */
export const TLV_OUT_9 = {
  kind: 'segmented',
  segments: [
    { from: 0, to: 0, db: null, step: 0, mute: true },
    { from: 1, to: 19, db: -88.0, step: 2.0 },
    { from: 20, to: 61, db: -51.0, step: 1.0 },
    { from: 62, to: 99, db: -9.5, step: 0.5 },
  ],
};

/**
 * Тип B: 2 сегмента.
 *   0       MUTE
 *   1..79   от -88.00 dB, шаг 1.00
 *   80..99  от  -9.50 dB, шаг 0.50
 */
export const TLV_OUT_0 = {
  kind: 'segmented',
  segments: [
    { from: 0, to: 0, db: null, step: 0, mute: true },
    { from: 1, to: 79, db: -88.0, step: 1.0 },
    { from: 80, to: 99, db: -9.5, step: 0.5 },
  ],
};

/** Волумы. target_pair != 0 -> писать в оба, слушать второй. */
export const VOLUMES = [
  { id: 'mic1',    name: 'Mic-1 Analog Capture Volume', target: 0x21, targetPair: 0,    prop: 0x04, min: 0, max: 88, tlv: TLV_GAIN  },
  { id: 'mic2',    name: 'Mic-2 Analog Capture Volume', target: 0x22, targetPair: 0,    prop: 0x04, min: 0, max: 88, tlv: TLV_GAIN  },
  { id: 'aux',     name: 'Aux Capture Volume',          target: 0x23, targetPair: 0,    prop: 0x04, min: 0, max: 99, tlv: TLV_OUT_9 },
  { id: 'bt',      name: 'Bluetooth Capture Volume',    target: 0x25, targetPair: 0,    prop: 0x04, min: 0, max: 99, tlv: TLV_OUT_0 },
  { id: 'otgin',   name: 'OTG Capture Volume',          target: 0x27, targetPair: 0,    prop: 0x04, min: 0, max: 99, tlv: TLV_OUT_0 },
  { id: 'hp',      name: 'Headphone Playback Volume',   target: 0x64, targetPair: 0x63, prop: 0x03, min: 0, max: 99, tlv: TLV_OUT_9 },
  { id: 'otgout',  name: 'OTG Playback Volume',         target: 0x62, targetPair: 0x61, prop: 0x03, min: 0, max: 99, tlv: TLV_OUT_0 },
];

/** Селекторы. Отвечают только на одном target пары. */
export const SELECTORS = [
  { id: 'hpSource',  name: 'Headphone Playback Source', target: 0x64, prop: 0x02 },
  { id: 'otgSource', name: 'OTG Playback Source',       target: 0x62, prop: 0x02 },
];

/**
 * Источники. Индекс в списке != значение для устройства:
 * есть дыра на 4 и 5.
 * Unknown = 0 — это НЕ выбор, запись его является no-op.
 */
export const SOURCES = [
  { index: 0,  label: 'Unknown',        value: 0,  isChoice: false },
  { index: 1,  label: 'Mix A',          value: 1,  isChoice: true },
  { index: 2,  label: 'Mix B',          value: 2,  isChoice: true },
  { index: 3,  label: 'Mix C',          value: 3,  isChoice: true },
  { index: 4,  label: 'IN 1',           value: 6,  isChoice: true },
  { index: 5,  label: 'IN 2',           value: 7,  isChoice: true },
  { index: 6,  label: 'IN 1+2',         value: 8,  isChoice: true },
  { index: 7,  label: 'AUX',            value: 9,  isChoice: true },
  { index: 8,  label: 'BT',             value: 10, isChoice: true },
  { index: 9,  label: 'OTG IN',         value: 11, isChoice: true },
  { index: 10, label: 'Playback 1/2',   value: 12, isChoice: true },
  { index: 11, label: 'Playback 3/4',   value: 13, isChoice: true },
  { index: 12, label: 'Playback 5/6',   value: 14, isChoice: true },
  { index: 13, label: 'Playback 7/8',   value: 15, isChoice: true },
  { index: 14, label: 'Playback 9/10',  value: 16, isChoice: true },
];

/** Индекс списка -> значение для устройства. */
export function sourceValue(index) {
  const s = SOURCES[index];
  return s ? s.value : null;
}

/** Значение устройства -> индекс списка (или null). */
export function sourceIndex(value) {
  const s = SOURCES.find((x) => x.value === value);
  return s ? s.index : null;
}

/**
 * Индекс громкости -> дБ. null означает mute.
 * @param {number} index
 * @param {object} tlv
 * @returns {number|null}
 */
export function indexToDb(index, tlv) {
  if (tlv.kind === 'gain') {
    // линейно, шаг 1.00 dB
    return index;
  }
  for (const seg of tlv.segments) {
    if (index < seg.from || index > seg.to) continue;
    if (seg.mute) return null;
    return seg.db + (index - seg.from) * seg.step;
  }
  return null;
}

/** Все контролы одним списком — для API/описания фронту. */
export function allControls() {
  return { volumes: VOLUMES, selectors: SELECTORS, sources: SOURCES };
}
