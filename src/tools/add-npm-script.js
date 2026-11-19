/**
 * Скрипт для добавления npm-скриптов без риска испортить package.json.
 *
 * ЗАЧЕМ: PowerShell при правке JSON через Replace съедает переносы
 * строк как литералы `\n`, и файл становится невалидным. Однажды это
 * уже сломало package.json (восстановлен из git).
 *
 * Правильный путь: читать/писать JSON через JSON.parse/stringify.
 *
 * Запуск: node src/tools/add-npm-script.js <имя> <команда>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , name, command] = process.argv;

if (!name || !command) {
  console.error('использование: node src/tools/add-npm-script.js <имя> <команда>');
  process.exit(1);
}

const raw = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(raw);

pkg.scripts ??= {};
pkg.scripts[name] = command;

writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

// Проверяем, что записали валидный JSON.
try {
  const check = JSON.parse(readFileSync('package.json', 'utf8'));
  console.log(`добавлен скрипт "${name}": ${check.scripts[name]}`);
  console.log(`всего скриптов: ${Object.keys(check.scripts).length}`);
} catch (err) {
  console.error('ОШИБКА: package.json стал невалидным:', err.message);
  process.exit(1);
}
