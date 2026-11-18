/**
 * Тест автовосстановления при ВЫДЁРГИВАНИИ (не ручном disconnect).
 *
 * Имитируем: транспорт теряет устройство (как при ENODEV),
 * бекенд должен сам переоткрыть его.
 */
import { M62Transport } from '../transport.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { info: (m) => console.log('   ' + m), warn: () => {}, error: () => {} };

const t = new M62Transport({ logger: log });
let reconnected = false;
let closeCount = 0;

t.on('close', () => { closeCount++; });
t.on('reconnected', () => { reconnected = true; });
t.on('error', () => { /* ожидаемо */ });

console.log('=== 1. открываю транспорт ===');
await t.open();
console.log(`  устройство: ${t.device ? 'открыто' : 'нет'}`);
await sleep(2000);

console.log('\n=== 2. имитирую потерю устройства (close без final) ===');
t.close();
console.log(`  устройство после close: ${t.device ? 'открыто' : 'закрыто'}`);
console.log(`  таймер реконнекта: ${t.reconnectTimer ? 'запланирован' : 'НЕТ'}`);

console.log('\n=== 3. жду автовосстановления (до 15 с) ===');
for (let i = 0; i < 30; i++) {
  await sleep(500);
  if (t.device) break;
}
console.log(`  устройство: ${t.device ? 'ВОССТАНОВЛЕНО' : 'нет'}`);
console.log(`  событие reconnected: ${reconnected ? 'ДА' : 'нет'}`);
console.log(`  попыток реконнекта: ${t.reconnectAttempts}`);

if (t.device) {
  console.log('\n=== 4. проверяю, что данные снова идут ===');
  const before = t.stats.reads;
  await sleep(2000);
  const after = t.stats.reads;
  console.log(`  чтений за 2 с: ${after - before}  ${after > before ? 'OK' : 'НЕТ ДАННЫХ'}`);
}

console.log('\n=== 5. проверяю ручной close({final:true}) ===');
t.close({ final: true });
console.log(`  устройство: ${t.device ? 'открыто' : 'закрыто'}`);
console.log(`  таймер реконнекта: ${t.reconnectTimer ? 'запланирован (ПЛОХО)' : 'нет (правильно)'}`);
await sleep(3000);
console.log(`  через 3 с устройство: ${t.device ? 'ВОССТАНОВИЛОСЬ (ПЛОХО)' : 'осталось закрытым (правильно)'}`);

console.log('\n=== ИТОГ ===');
const ok = reconnected && !t.device;
console.log(`  автовосстановление при потере: ${reconnected ? 'работает' : 'НЕ РАБОТАЕТ'}`);
console.log(`  final close не восстанавливается: ${!t.device ? 'да' : 'НЕТ'}`);
process.exit(ok ? 0 : 1);
