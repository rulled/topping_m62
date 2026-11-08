/**
 * Протокол M62: сборка и разбор кадров.
 *
 * Отправляем 15 байт:
 *   22 33 | 20 01 01 | TT | PP | s32 BE | CRC16 BE | 66 77
 *
 * Принимаем: те же 15 байт + 1 байт паддинга (+ report ID от HID-слоя).
 *
 * Источник: mainline-драйвер hid-topping (Mikhail Gavrilov),
 * проверено на firmware V87.05.45.48.27.
 */

import { crc16modbus } from './crc16.js';

export const FRAME_LEN = 15;      // что отправляем
export const REPORT_LEN = 16;     // что принимаем (кадр + паддинг)
export const HID_REPORT_LEN = 17; // + report ID на уровне HID

export const MAGIC_HEAD = [0x22, 0x33];
export const MAGIC_TAIL = [0x66, 0x77];
export const HEADER_FIXED = [0x20, 0x01, 0x01];

/** Device-scope targets. */
export const TT_DEVICE = 0x11;
export const PP_SUBSCRIBE = 0x24;
export const PP_ANNOUNCE = 0x26;

/**
 * Session handshake — ОБЯЗАТЕЛЕН.
 *
 * Источник: github.com/NTMan/topping-m62 (PROTOCOL.md, CC0):
 * «`11/01` is a session handshake with a reply: host writes 1, the
 * device answers 3. MCC sends nothing after `11/01` until the card
 * has answered it.»
 *
 * БЕЗ НЕГО КАРТА МОЛЧИТ ПО ЧАСТИ СОСТОЯНИЯ. Проверено на нашем
 * устройстве: до handshake приходило 44 тега, после — 96.
 * Раскрываются: компрессор (0x46:0x01..0x08), EQ-полосы
 * (0x91..0x94 × 10), EQ-переключатели (0x9b:0x0f/0x10/0x12/0x13).
 *
 * Наше устройство отвечает `2` (не 3) — версия прошивки другая,
 * но ответ есть, и этого достаточно.
 */
export const PP_HANDSHAKE = 0x01;

/** Открыть/закрыть bulk push (пакетную отправку состояния). */
export const PP_BULK_BEGIN = 0x20;

/** Сохранить состояние в энергонезависимую память устройства. */
export const PP_SAVE = 0x05;

/** Период продления подписки. Устройство замолкает без него. */
export const KEEPALIVE_MS = 2000;

/**
 * Собирает 15-байтовый кадр.
 * @param {number} target  TT
 * @param {number} prop    PP
 * @param {number} value   знаменательное s32
 * @param {boolean} [withCrc=true] false -> пишет 00 00 (устройство принимает)
 * @returns {Uint8Array} 15 байт
 */
export function buildFrame(target, prop, value, withCrc = true) {
  const f = new Uint8Array(FRAME_LEN);
  f[0] = MAGIC_HEAD[0];
  f[1] = MAGIC_HEAD[1];
  f[2] = HEADER_FIXED[0];
  f[3] = HEADER_FIXED[1];
  f[4] = HEADER_FIXED[2];
  f[5] = target & 0xff;
  f[6] = prop & 0xff;

  // s32 big-endian
  const v = value | 0;
  f[7] = (v >>> 24) & 0xff;
  f[8] = (v >>> 16) & 0xff;
  f[9] = (v >>> 8) & 0xff;
  f[10] = v & 0xff;

  if (withCrc) {
    const crc = crc16modbus(f.subarray(2, 11));
    f[11] = (crc >>> 8) & 0xff;
    f[12] = crc & 0xff;
  } else {
    f[11] = 0;
    f[12] = 0;
  }

  f[13] = MAGIC_TAIL[0];
  f[14] = MAGIC_TAIL[1];
  return f;
}

/**
 * Оборачивает кадр в буфер, который ждёт Windows HID API:
 * спереди байт report ID (0x00).
 * @param {Uint8Array} frame 15 байт
 * @returns {Buffer} 16 байт
 */
export function withReportId(frame) {
  const out = Buffer.alloc(frame.length + 1);
  out[0] = 0x00;
  Buffer.from(frame).copy(out, 1);
  return out;
}

/**
 * Разбирает входящий отчёт.
 * @param {Buffer|Uint8Array} report от устройства (17 байт с report ID
 *        либо 16 байт без него — обрабатываем оба случая)
 * @returns {null | {target:number, prop:number, value:number, crcOk:boolean, crc:number, raw:Uint8Array}}
 */
export function parseReport(report) {
  if (!report || report.length < REPORT_LEN) return null;

  // node-hid может вернуть массив, Buffer или Uint8Array — приводим.
  let d = report instanceof Uint8Array ? report : Uint8Array.from(report);

  // Отбрасываем ведущий report ID, если он есть и кадр сдвинут.
  if (d[0] !== MAGIC_HEAD[0] && d.length >= HID_REPORT_LEN) {
    d = d.subarray(1);
  }
  if (d.length < REPORT_LEN) return null;
  if (d[0] !== MAGIC_HEAD[0] || d[1] !== MAGIC_HEAD[1]) return null;
  if (d[13] !== MAGIC_TAIL[0] || d[14] !== MAGIC_TAIL[1]) return null;

  const crc = ((d[11] << 8) | d[12]) & 0xffff;
  const crcOk = crc === crc16modbus(d.subarray(2, 11));

  // s32 BE
  const value = ((d[7] << 24) | (d[8] << 16) | (d[9] << 8) | d[10]) | 0;

  return {
    target: d[5],
    prop: d[6],
    value,
    crc,
    crcOk,
    raw: Uint8Array.from(d.subarray(0, REPORT_LEN)),
  };
}

/** Пустой опрос — 16 нулей. */
export function isIdle(report) {
  if (!report) return false;
  for (let i = 0; i < report.length; i++) if (report[i] !== 0) return false;
  return true;
}
