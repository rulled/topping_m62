/**
 * CRC-16/MODBUS.
 *
 * poly   0x8005 (reflected 0xA001)
 * init   0xFFFF
 * refin  true
 * refout true
 * xorout 0x0000
 *
 * Используется для байтов 2..10 кадра M62.
 * Устройство CRC не проверяет, но мы считаем корректно.
 */

const TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    t[i] = crc;
  }
  return t;
})();

/**
 * @param {Uint8Array} data
 * @param {number} [init=0xFFFF]
 * @returns {number} uint16
 */
export function crc16modbus(data, init = 0xffff) {
  let crc = init;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ data[i]) & 0xff];
  }
  return crc & 0xffff;
}
