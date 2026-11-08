/**
 * НАСТРОЙКИ УСТРОЙСТВА M62 — проверенные на живом устройстве.
 *
 * Все адреса и значения перечислений подтверждены перебором через
 * M Control Center (2026-11-07). Отчёт: research/PIPELINE.md §9.
 *
 * ВАЖНО: модуль даёт только ОПИСАНИЕ и чистые преобразования.
 * Функции записи — в settings-service.js.
 */

/** Тумблеры (вкл/выкл). */
export const TOGGLES = [
  {
    id: 'bluetooth',
    name: 'Bluetooth',
    target: 0x11,
    prop: 0x1a,
    values: { 0: 'Off', 1: 'On' },
    verified: true,
  },
  {
    id: 'autoPower',
    name: 'Auto Power On/Off',
    target: 0x11,
    prop: 0x1e,
    values: { 0: 'Off', 1: 'On' },
    verified: true,
  },
];

/**
 * Комбобоксы (перечисления).
 * Порядок в `options` соответствует порядку пунктов в UI MCC.
 */
export const ENUMS = [
  {
    id: 'brightness',
    name: 'Brightness',
    target: 0x11,
    prop: 0x04,
    options: [
      { value: 0, label: 'Dim' },
      { value: 1, label: 'Normal' },
      { value: 2, label: 'Bright' },
    ],
    verified: true,
  },
  {
    id: 'otgPower',
    name: 'OTG port power setting',
    target: 0x11,
    prop: 0x1b,
    options: [
      { value: 1, label: 'Discharge' },
      { value: 0, label: 'Off' },
    ],
    verified: true,
    note: 'порядок пунктов в UI: Discharge, Off — значения 1, 0',
  },
  {
    id: 'usbCPower',
    name: 'USB-C port power setting',
    target: 0x11,
    prop: 0x1c,
    options: [
      { value: 1, label: 'Charge' },
      { value: 2, label: 'Discharge' },
      { value: 3, label: 'Off' },
    ],
    verified: true,
  },
  {
    id: 'mode',
    name: 'Mode select',
    target: 0x11,
    prop: 0x1d,
    options: [
      { value: 1, label: 'Mobile mode' },
      { value: 2, label: 'Live streaming mode' },
      { value: 3, label: 'Pro audio mode' },
    ],
    verified: true,
    writeOnly: true,
    note: 'устройство НЕ возвращает это значение; смена режима перезагружает его',
  },
  {
    id: 'mainButtonSingle',
    name: 'Main button single-click',
    target: 0x11,
    prop: 0x22,
    options: [
      { value: 0, label: 'Battery Level' },
      { value: 1, label: 'Mute IN1&2' },
      { value: 2, label: 'Mute HP Out' },
      { value: 3, label: 'Mute OTG Out' },
      { value: 4, label: 'Toggle User 1/2' },
      { value: 5, label: 'Chat/Vocal scene' },
    ],
    verified: true,
  },
  {
    id: 'mainButtonDouble',
    name: 'Main button double-click',
    target: 0x11,
    prop: 0x23,
    options: [
      { value: 0, label: 'Battery Level' },
      { value: 1, label: 'Mute IN1&2' },
      { value: 2, label: 'Mute HP Out' },
      { value: 3, label: 'Mute OTG Out' },
      { value: 4, label: 'Toggle User 1/2' },
      { value: 5, label: 'Chat/Vocal scene' },
    ],
    verified: true,
  },
];

/** Команды (не состояние — устройство их не возвращает). */
export const COMMANDS = [
  { id: 'savePreset1', name: 'Save preset 1', target: 0x11, prop: 0x08 },
  { id: 'savePreset2', name: 'Save preset 2', target: 0x11, prop: 0x0b },
  { id: 'loadPreset1', name: 'Load preset 1', target: 0x11, prop: 0x0e },
  { id: 'loadPreset2', name: 'Load preset 2', target: 0x11, prop: 0x12 },
  { id: 'sceneChat', name: 'Scene: Chat', target: 0x45, prop: 0x01 },
  { id: 'sceneVocal', name: 'Scene: Vocal', target: 0x45, prop: 0x02 },
  { id: 'restoreDefault', name: 'Reset to factory default', target: 0x11, prop: 0x21 },
  { id: 'updateFirmware', name: 'Update firmware', target: 0x11, prop: 0x1f },
  { id: 'loadSettings', name: 'Load settings', target: 0x11, prop: 0x20 },
];

/**
 * ВНИМАНИЕ: restoreDefault СБРАСЫВАЕТ ВСЁ. Требует подтверждения.
 */
export const DESTRUCTIVE = new Set(['restoreDefault', 'updateFirmware']);

/**
 * Прочие читаемые параметры устройства.
 *
 * ВАЖНО (исправлено 2026-11-07, research/NOTES.md §108):
 * `0x11:0x18` — это НЕ «счётчик изменений», а УРОВЕНЬ ЗАРЯДА БАТАРЕИ (%).
 * Доказательства: значения всегда 0..100; в UI есть виджет `BatteryS1M1`;
 * история 72->78->92->99->91 типична для батареи (заряжалась, потом разряжается);
 * не меняется при перезапуске MCC.
 *
 * `0x11:0x19` — статус зарядки (0/1), предположительно.
 */
export const STATUS = [
  {
    id: 'battery',
    name: 'Заряд батареи',
    target: 0x11,
    prop: 0x18,
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    id: 'charging',
    name: 'Статус зарядки',
    target: 0x11,
    prop: 0x19,
    options: [
      { value: 0, label: 'Не заряжается' },
      { value: 1, label: 'Заряжается' },
    ],
  },
];

/** Найти описание по id. */
export function findSetting(id) {
  return (
    TOGGLES.find((t) => t.id === id) ??
    ENUMS.find((e) => e.id === id) ??
    COMMANDS.find((c) => c.id === id) ??
    null
  );
}

/** Метка значения для enum. */
export function labelFor(enumDef, value) {
  const o = enumDef.options.find((x) => x.value === value);
  return o ? o.label : null;
}

/** Описание всех настроек для API/фронта. */
export function describeSettings() {
  return {
    toggles: TOGGLES.map((t) => ({ ...t })),
    enums: ENUMS.map((e) => ({ ...e })),
    commands: COMMANDS.map((c) => ({ ...c, destructive: DESTRUCTIVE.has(c.id) })),
    status: STATUS.map((s) => ({ ...s })),
  };
}
