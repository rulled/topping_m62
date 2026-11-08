/**
 * АНАЛИЗ ВОЗМОЖНОСТИ WebHID.
 *
 * Chrome WebHID требует:
 *   1. navigator.hid.requestDevice({filters}) — фильтры по vendorId/productId
 *      ИЛИ usagePage/usage.
 *   2. Валидный report descriptor.
 *   3. Обмен через input/output reports (interrupt endpoints).
 *   4. Сообщения размером до 65535 байт (у нас 17 — ок).
 *   5. Разрешение пользователя (gesture).
 *
 * Проблемы, которые надо проверить:
 *   - Usage=0x00 нестандартный: фильтр по usage может не сработать.
 *   - Feature report = 0: WebHID sendFeatureReport не будет работать.
 *   - device.open() требует, чтобы ОС не держала устройство эксклюзивно.
 */
import HID from 'node-hid';

const VID = 0x152a;
const PID = 0x875c;

console.log('=== WEBHID COMPATIBILITY ANALYSIS ===\n');

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all[0];

if (!dev) {
  console.log('устройство не найдено');
  process.exit(1);
}

console.log('1. ИДЕНТИФИКАЦИЯ');
console.log(`   vendorId:  0x${VID.toString(16).toUpperCase()}`);
console.log(`   productId: 0x${PID.toString(16).toUpperCase()}`);
console.log(`   product:   ${dev.product ?? '?'}`);
console.log(`   interface: ${dev.interface}`);

console.log('\n2. FILTERS ДЛЯ requestDevice()');
console.log('   Вариант A (по VID/PID) — самый надёжный:');
console.log(`     { vendorId: 0x${VID.toString(16)}, productId: 0x${PID.toString(16)} }`);
console.log('   Вариант B (по usage) — Usage=0x00, вероятно не сработает:');
console.log(`     { usagePage: 0x01, usage: 0x00 }`);

console.log('\n3. REPORT SIZE');
console.log('   inputReportLength:  17 байт (1 report ID + 16)');
console.log('   outputReportLength: 17 байт');
console.log('   featureReportLength: 0 — sendFeatureReport НЕ БУДЕТ РАБОТАТЬ');
console.log('   Лимит WebHID: 65535 байт — OK');

console.log('\n4. ПРОТОКОЛ');
console.log('   Кадр 15 байт + report ID = 16, плюс pad = 17.');
console.log('   WebHID: device.sendReport(0, data16) — report id 0, data 16 байт.');
console.log('   Чтение: event.inputreport → 17 байт.');
console.log('   Подписка: 0x11:0x24, keepalive каждые 2 с через setInterval.');

console.log('\n5. ОГРАНИЧЕНИЯ БРАУЗЕРА');
console.log('   - Только Chrome/Edge (не Firefox/Safari).');
console.log('   - Требуется HTTPS или localhost.');
console.log('   - Требуется gesture пользователя (клик) для requestDevice.');
console.log('   - Разрешение запоминается по origin.');
console.log('   - Фоновая вкладка: таймеры душатся (throttling) — keepalive может сорваться.');
console.log('   - При закрытии вкладки устройство освобождается.');

console.log('\n6. КОНФЛИКТ С ДРАЙВЕРОМ');
console.log('   Если M Control Center запущен и держит device — WebHID может не открыть.');
console.log('   Проверка: открыть HID вторым читателем (мы это делали — работает).');
console.log('   Но WebHID требует write, поэтому конфликт вероятнее.');

console.log('\n=== ВЕРДИКТ ===');
console.log('Технически WebHID подходит:');
console.log('  + device открывается по VID/PID');
console.log('  + input/output reports 17 байт (в пределах лимита)');
console.log('  + протокол простой (15-байтовый кадр)');
console.log('');
console.log('Но есть реальные проблемы:');
console.log('  - feature reports = 0 (не критично, мы их не используем)');
console.log('  - keepalive 2 с в фоновой вкладке может сорваться');
console.log('  - конфликт с M Control Center за устройство');
console.log('  - Usage=0x00 — фильтр по usage может не сработать');
console.log('');
console.log('ВЫВОД: WebHID возможен как ОПЦИЯ, но бекенд надёжнее.');
