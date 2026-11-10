/**
 * РЕВЕРБ ЧЕРЕЗ HID — чтение и запись без M Control Center.
 *
 * ═══ ОТКУДА КАРТА ═══
 *
 * Из дизассемблера M Control Center (research/NOTES.md §11.5, функция
 * FUN_140230b20) и подтверждено на живом устройстве 2026-11-10:
 *
 *   0x44:08 = DryWet
 *   0x44:09 = Room
 *   0x44:0a = Decay
 *   0x44:0b = ReverbType   (Bypass=1, STUDIO=2, LIVE=3, HALL=4)
 *   0x44:0c = MuteFX
 *   0x44:0f = Width        (значение = int(x * 100))
 *
 * ═══ ГЛАВНАЯ ЛОВУШКА ═══
 *
 * ВНИМАНИЕ: при ReverbType = Bypass (1) параметры DryWet, Room,
 * Decay, Width НЕ ПРИНИМАЮТСЯ. Устройство молча игнорирует запись,
 * значение остаётся прежним.
 *
 * Это записано в research/NOTES.md §71 применительно к дилам MCC
 * («dial'ы реверба не реагируют, когда реверб в Bypass»), и оказалось
 * верным и для прямой записи в HID.
 *
 * Из-за этого первая проверка дала ложный вывод «реверб не пишется
 * через HID вообще»: тест шёл при Bypass. Правильный порядок:
 *
 *   1. включить тип (0x44:0b = 2/3/4)
 *   2. менять параметры
 *   3. вернуть прежний тип последним
 *
 * Проверено 2026-11-10 при типе LIVE, все четыре принялись:
 *   DryWet 25 -> 40, Room 4 -> 6, Decay 11 -> 14, Width 70 -> 80.
 *
 * ═══ ЕДИНИЦЫ ═══
 *
 *   dryWet  — 0..100
 *   room    — 0..100 (в файле MCC называется Reverb<Type>)
 *   decay   — 0..100
 *   width   — 0..1 в файле, но в HID передаётся как x100 (0.7 -> 70)
 *   type    — 1=Bypass, 2=STUDIO, 3=LIVE, 4=HALL
 *   muteFx  — 0/1
 */

const TT_FX = 0x44;

/** Параметр -> свойство. */
export const REVERB_FIELDS = {
  dryWet: { prop: 0x08, min: 0, max: 100, scale: 1, unit: '' },
  room: { prop: 0x09, min: 0, max: 100, scale: 1, unit: '' },
  decay: { prop: 0x0a, min: 0, max: 100, scale: 1, unit: '' },
  type: { prop: 0x0b, min: 1, max: 4, scale: 1, unit: '' },
  muteFx: { prop: 0x0c, min: 0, max: 1, scale: 1, unit: '' },
  width: { prop: 0x0f, min: 0, max: 1, scale: 100, unit: '' },
};

export const REVERB_FIELD_NAMES = Object.keys(REVERB_FIELDS);

/** Типы реверба: код устройства -> имя. */
export const REVERB_TYPES = {
  1: 'Bypass',
  2: 'STUDIO',
  3: 'LIVE',
  4: 'HALL',
};

/** Имя -> код. Принимаем и «Bypass», и «bypass». */
export const REVERB_TYPE_CODES = Object.fromEntries(
  Object.entries(REVERB_TYPES).map(([code, name]) => [name, Number(code)]),
);

/** Код по умолчанию для «выключено». */
export const REVERB_BYPASS = 1;

/** Проверяет значение, бросает с понятным текстом. */
export function validateReverbValue(field, value) {
  const f = REVERB_FIELDS[field];
  if (!f) {
    throw new Error(`неизвестный параметр реверба: ${field}; допустимо ${REVERB_FIELD_NAMES.join(', ')}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field}: ожидалось число, получили "${value}"`);
  if (n < f.min || n > f.max) {
    throw new Error(`${field}: значение ${n} вне диапазона ${f.min}..${f.max}`);
  }
  return n;
}

/** Приводит имя типа к коду, принимая разные написания. */
export function typeCode(type) {
  if (typeof type === 'number') {
    if (REVERB_TYPES[type]) return type;
    throw new Error(`неизвестный код типа реверба: ${type}; допустимо 1..4`);
  }
  const raw = String(type ?? '').trim();
  if (!raw) throw new Error('type пустой');
  // точное совпадение
  if (REVERB_TYPE_CODES[raw] !== undefined) return REVERB_TYPE_CODES[raw];
  // без учёта регистра
  const found = Object.keys(REVERB_TYPE_CODES).find((k) => k.toLowerCase() === raw.toLowerCase());
  if (found !== undefined) return REVERB_TYPE_CODES[found];
  throw new Error(
    `неизвестный тип реверба: ${raw}; допустимо ${Object.keys(REVERB_TYPE_CODES).join(', ')}`,
  );
}

/** Из человеческого значения в то, что ждёт устройство. */
export function toDeviceValue(field, value) {
  const f = REVERB_FIELDS[field];
  if (!f) throw new Error(`неизвестный параметр реверба: ${field}`);
  return Math.round(value * f.scale);
}

/** Обратно. */
export function fromDeviceValue(field, raw) {
  if (raw === null || raw === undefined) return null;
  const f = REVERB_FIELDS[field];
  if (!f) return raw;
  if (field === 'width') return raw / f.scale;
  return raw;
}

/** Кадры для установки одного параметра. */
export function buildReverbFrames(field, value) {
  const v = validateReverbValue(field, value);
  const f = REVERB_FIELDS[field];
  return [{ target: TT_FX, prop: f.prop, value: toDeviceValue(field, v) }];
}

/** Достаёт значение тега из снимка, понимая оба формата ключей. */
function snapshotValue(snapshot, prop) {
  if (!snapshot) return undefined;
  const hexKey = `44:${prop.toString(16).padStart(2, '0')}`;
  if (snapshot[hexKey] !== undefined) return snapshot[hexKey];
  const decKey = `${TT_FX}:${prop}`;
  if (snapshot[decKey] !== undefined) return snapshot[decKey];
  if (snapshot instanceof Map) {
    for (const [k, v] of snapshot) {
      const [a, b] = String(k).split(':');
      if (a === undefined || b === undefined) continue;
      if (parseInt(a, 16) !== TT_FX && Number(a) !== TT_FX) continue;
      if (parseInt(b, 16) === prop || Number(b) === prop) return v;
    }
  }
  return undefined;
}

/**
 * Читает состояние реверба из снимка.
 * @returns {{dryWet, room, decay, type, typeName, muteFx, width, bypass}}
 */
export function readReverb(snapshot) {
  const out = {};
  for (const field of REVERB_FIELD_NAMES) {
    const raw = snapshotValue(snapshot, REVERB_FIELDS[field].prop);
    out[field] = fromDeviceValue(field, raw);
  }
  out.typeName = REVERB_TYPES[out.type] ?? null;
  out.bypass = out.type === REVERB_BYPASS;
  return out;
}

/**
 * Собирает кадры для установки нескольких параметров С ПРАВИЛЬНЫМ
 * ПОРЯДКОМ: тип первым, если он включается.
 *
 * Зачем: при Bypass остальные параметры игнорируются, поэтому
 * «включить тип + задать параметры» одной пачкой работает, а
 * «задать параметры при Bypass» — нет.
 *
 * @param {Record<string, number|string>} values
 * @param {{currentType?: number}} [opts]
 * @returns {{frames: Array, warnings: string[]}}
 */
export function buildReverbBatch(values, opts = {}) {
  const warnings = [];
  const frames = [];

  const wantType = values.type !== undefined ? typeCode(values.type) : null;
  const currentType = opts.currentType;

  // 1. тип — первым
  if (wantType !== null) {
    const f = REVERB_FIELDS.type;
    frames.push({ target: TT_FX, prop: f.prop, value: wantType });
  }

  // 2. параметры
  const params = REVERB_FIELD_NAMES.filter((k) => k !== 'type' && values[k] !== undefined);
  for (const field of params) {
    const v = validateReverbValue(field, values[field]);
    const f = REVERB_FIELDS[field];
    frames.push({ target: TT_FX, prop: f.prop, value: toDeviceValue(field, v) });
  }

  // 3. предупреждение, если параметры шлются при Bypass
  const effectiveType = wantType ?? currentType;
  if (params.length > 0 && effectiveType === REVERB_BYPASS) {
    warnings.push(
      'реверб в Bypass: параметры DryWet/Room/Decay/Width игнорируются. '
      + 'Сначала включите тип (STUDIO/LIVE/HALL), потом меняйте параметры.',
    );
  }

  return { frames, warnings };
}

/** Описание для API. */
export function describeReverbHid() {
  return {
    fields: REVERB_FIELD_NAMES,
    types: REVERB_TYPES,
    typeCodes: Object.fromEntries(
      Object.entries(REVERB_TYPES).map(([code, name]) => [name, Number(code)]),
    ),
    addresses: Object.fromEntries(
      Object.entries(REVERB_FIELDS).map(([k, f]) => [k, `0x44:0x${f.prop.toString(16).padStart(2, '0')}`]),
    ),
    limits: Object.fromEntries(
      Object.entries(REVERB_FIELDS).map(([k, f]) => [k, { min: f.min, max: f.max, scale: f.scale }]),
    ),
    note: 'Width передаётся как x100 (0.7 -> 70). '
      + 'ПРИ Bypass параметры не применяются — сначала включите тип.',
  };
}
