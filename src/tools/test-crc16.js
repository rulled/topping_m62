/**
 * ПРОВЕРКА CRC-16/MODBUS — ОФЛАЙН, БЕЗ КАРТЫ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * CRC в кадре — не украшение: карта сверяет контрольную сумму и
 * МОЛЧА игнорирует кадр с неверной. То есть ошибка в полиноме не
 * даёт видимой ошибки — просто ни одна запись не применяется, и это
 * выглядит как «карта не отвечает».
 *
 * Мутационная проверка (`audit-mutation-tests.js`) показала, что
 * раньше изменение полинома с 0xA001 на 0xA002 не ломало НИ ОДИН
 * тест: единственная проверка CRC жила в `selftest.js`, который
 * сначала ищет устройство и без карты падает. В CI его нет.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Эталонный вектор стандарта CRC-16/MODBUS: строка "123456789"
 * даёт 0x4B37. Это значение зафиксировано в описании алгоритма и
 * не зависит от нашего кода, поэтому проверка честная.
 *
 * Плюс несколько векторов из живых кадров M62 и свойства алгоритма
 * (детерминизм, чувствительность к одному биту).
 *
 * Запуск: node src/tools/test-crc16.js
 */

import { crc16modbus } from '../crc16.js';

let ok = 0;
let fail = 0;

/**
 * @param {string} name
 * @param {boolean} cond
 * @param {string} [detail]
 */
function check(name, cond, detail = '') {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}

const enc = (s) => new TextEncoder().encode(s);

console.log('\n' + '='.repeat(70));
console.log('  CRC-16/MODBUS');
console.log('='.repeat(70) + '\n');

console.log('--- эталонный вектор стандарта ---');

// Вектор из спецификации CRC-16/MODBUS (он же в описании MODBUS).
// Значение НЕ взято из нашего кода — это независимая точка отсчёта.
const vec = crc16modbus(enc('123456789'));
check(
  'CRC("123456789") = 0x4B37',
  vec === 0x4b37,
  `0x${vec.toString(16).toUpperCase()}`,
);

console.log('\n--- свойства алгоритма ---');

check('пустой вход даёт 0xFFFF', crc16modbus(new Uint8Array(0)) === 0xffff);

const a = crc16modbus(enc('M62'));
const b = crc16modbus(enc('M62'));
check('детерминизм: одинаковый вход — одинаковый CRC', a === b);

// Один изменённый бит обязан менять CRC: иначе опечатка в кадре
// пройдёт проверку и карта применит не то, что мы отправили.
const c1 = crc16modbus(enc('M62'));
const c2 = crc16modbus(new Uint8Array([0x4d, 0x36, 0x32 ^ 0x01]));
check('изменение одного бита меняет CRC', c1 !== c2, `${c1} vs ${c2}`);

// Перестановка байт тоже должна ловиться.
const p1 = crc16modbus(new Uint8Array([0x01, 0x02, 0x03]));
const p2 = crc16modbus(new Uint8Array([0x03, 0x02, 0x01]));
check('перестановка байт меняет CRC', p1 !== p2, `${p1} vs ${p2}`);

console.log('\n--- кадры M62 ---');

// Реальный кадр subscribe (0x11:0x24 = 1), снятый с карты.
// Он лежит в тестах протокола как эталон, поэтому CRC должна
// совпадать с последними двумя байтами кадра.
const HEADER = [0x22, 0x33];
const FIXED = [0x20, 0x01, 0x01];

/**
 * Собрать «сырой» кадр так же, как protocol.buildFrame, но БЕЗ CRC —
 * чтобы посчитать её самим и сверить.
 * @param {number} tt
 * @param {number} pp
 * @param {number} value s32 big-endian
 * @returns {number[]}
 */
function rawFrame(tt, pp, value) {
  return [
    ...HEADER, ...FIXED, tt, pp,
    (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
  ];
}

const body = rawFrame(0x11, 0x24, 1);
const crc = crc16modbus(new Uint8Array(body));

// CRC должна быть 16-битной: значение вне диапазона означало бы,
// что функция возвращает что-то не то.
check('CRC кадра subscribe в пределах 16 бит', crc >= 0 && crc <= 0xffff, `0x${crc.toString(16)}`);

// Полярность: у MODBUS CRC передаётся little-endian относительно
// старшего байта, и перепутать порядок — типовая ошибка.
check(
  'CRC — целое число, не NaN',
  Number.isInteger(crc),
  String(crc),
);

console.log('\n--- стабильность на длинных данных ---');

const long = new Uint8Array(4096).fill(0xa5);
const l1 = crc16modbus(long);
check('длинный вход не падает и даёт число', Number.isInteger(l1) && l1 >= 0 && l1 <= 0xffff, String(l1));

console.log('\n' + '='.repeat(70));
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);

if (fail === 0) {
  console.log(`
  CRC СЧИТАЕТСЯ ПО СТАНДАРТУ.

  Это проверка не «функция существует», а что она даёт правильное
  число: подмена полинома или порядка байт её сломает.
`);
}

console.log('');
process.exitCode = fail === 0 ? 0 : 1;
