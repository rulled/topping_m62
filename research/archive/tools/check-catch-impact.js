/**
 * Проверка: не скрывают ли эти catch реальные проблемы?
 *
 * Особенно server.js:476 — readEqTypes() в catch.
 */
import { readEqTypes, isEqWindowOpen } from '../eq-control.js';

console.log('=== ПРОВЕРКА readEqTypes ===');
console.log(`окно EQ: ${isEqWindowOpen() ? 'открыто' : 'закрыто'}`);

try {
  const types = readEqTypes();
  console.log(`  типы получены: ${JSON.stringify(types)}`);
} catch (e) {
  console.log(`  ОШИБКА (скрывалась бы в catch): ${e.message}`);
  console.log('  ---');
  console.log('  Это ожидаемо, если окно EQ закрыто.');
  console.log('  Но в /api/eq поле types будет отсутствовать БЕЗ объяснения.');
}

console.log('\n=== ПРОВЕРКА settings-service catch на строке 240 ===');
console.log('  читаем код вокруг...');
import { readFileSync } from 'node:fs';
const src = readFileSync('src/settings-service.js', 'utf8').split('\n');
for (let i = 228; i < 250; i++) {
  if (src[i]) console.log(`  ${i + 1}: ${src[i]}`);
}
