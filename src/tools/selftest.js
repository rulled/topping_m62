/**
 * Самопроверка:
 *  1. находит M62
 *  2. проверяет CRC на известных векторах
 *  3. открывает HID interface 4
 *  4. подписывается и слушает 8 секунд
 *
 * Ничего не пишет в устройство, кроме подписки и запроса состояния —
 * это те же кадры, что шлёт вендорское приложение.
 */

import { M62Transport } from '../transport.js';
import { buildFrame, parseReport } from '../protocol.js';
import { crc16modbus } from '../crc16.js';

console.log('=== 1. поиск устройства ===');
const found = M62Transport.find();
if (!found) {
  console.log('M62 не найден');
  process.exit(1);
}
console.log('  path        :', found.path);
console.log('  interface   :', found.interface);
console.log('  product     :', found.product);
console.log('  manufacturer:', found.manufacturer);
console.log('  все iface   :', JSON.stringify(found.all));

console.log('\n=== 2. проверка CRC-16/MODBUS ===');
// Известный вектор: "123456789" -> 0x4B37
const vec = new TextEncoder().encode('123456789');
const got = crc16modbus(vec);
console.log(`  CRC("123456789") = 0x${got.toString(16).toUpperCase()}`);
console.log(`  ожидается        0x4B37  ${got === 0x4b37 ? 'OK' : 'НЕ СОВПАЛО'}`);

console.log('\n=== 3. сборка кадра ===');
const f = buildFrame(0x11, 0x24, 1);
console.log('  subscribe ->', Buffer.from(f).toString('hex').replace(/(..)/g, '$1 ').trim());

const f2 = buildFrame(0x64, 0x03, 50);
console.log('  hp vol 50 ->', Buffer.from(f2).toString('hex').replace(/(..)/g, '$1 ').trim());

console.log('\n=== 4. разбор синтетического отчёта ===');
const rep = Buffer.concat([Buffer.from([0x00]), Buffer.from(f2), Buffer.from([0x00])]);
const parsed = parseReport(rep);
console.log('  ', JSON.stringify({ ...parsed, raw: undefined }));

console.log('\n=== 5. открытие и прослушивание 8 секунд ===');
const t = new M62Transport({
  logger: { info: (...a) => console.log('  [i]', ...a), warn: (...a) => console.log('  [w]', ...a) },
});

let events = 0;
t.on('event', (ev) => {
  events++;
  console.log(
    `  событие #${events}: TT=0x${ev.target.toString(16).padStart(2, '0')} ` +
      `PP=0x${ev.prop.toString(16).padStart(2, '0')} ` +
      `value=${ev.value} changed=${ev.changed}`,
  );
});
t.on('unknown', (raw) => {
  console.log('  нераспознанный отчёт:', Buffer.from(raw).toString('hex'));
});
t.on('badcrc', (m) => console.log('  плохой CRC:', JSON.stringify({ ...m, raw: undefined })));
t.on('error', (e) => console.log('  ошибка:', e?.message ?? e));

try {
  await t.open();
  console.log('  устройство открыто, подписка отправлена');
} catch (e) {
  console.log('  не удалось открыть:', e.message);
  process.exit(1);
}

setTimeout(() => {
  console.log('\n=== итог ===');
  console.log('  событий получено:', events);
  console.log('  статистика      :', JSON.stringify(t.stats));
  console.log('  кеш значений    :', JSON.stringify(t.snapshot()));
  t.close();
  process.exit(0);
}, 8000);
