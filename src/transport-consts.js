/**
 * КОНСТАНТЫ УСТРОЙСТВА (без зависимостей — годится и для браузера).
 */

/** TOPPING M62. */
export const VID = 0x152a;
export const PID = 0x875c;

/**
 * Interface 4 — vendor control channel.
 *
 * ⚠ Interface 3 — это DFU. Писать туда НИКОГДА нельзя: можно
 * превратить карту в кирпич. Мы всегда открываем только 4.
 */
export const VENDOR_INTERFACE = 4;

/** Эндпоинты vendor-интерфейса (для WebHID). */
export const ENDPOINT_OUT = 0x02;
export const ENDPOINT_IN = 0x83;

/** Человеческие имена режимов. */
export const MODE_NAMES = {
  1: 'Mobile',
  2: 'Live',
  3: 'Prof',
};
