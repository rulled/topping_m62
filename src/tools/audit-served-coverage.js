/**
 * ВСЕ ЛИ МОДУЛИ, НУЖНЫЕ БРАУЗЕРУ, ОТДАЮТСЯ СЕРВЕРОМ.
 *
 * ═══ КАКОЙ БАГ ЛОВИТСЯ ═══
 *
 * static-server.js отдаёт НЕ всё подряд, а только файлы из белого
 * списка — это осознанное решение по безопасности (не отдавать
 * дампы, скрипты реверса, .env).
 *
 * Обратная сторона: если в код добавят новый `import`, а путь не
 * попадёт в белый список, страница на хостинге упадёт с 404 — при
 * этом локально (через dev-сервер, который отдаёт всё) всё будет
 * работать. Такой баг опасен именно тем, что не воспроизводится на
 * машине разработчика.
 *
 * ═══ ЧТО ИМЕННО СВЕРЯЕТСЯ ═══
 *
 * Только БРАУЗЕРНАЯ часть графа. Серверные модули отдавать не надо —
 * в этом и смысл белого списка.
 *
 * ═══ ПОЧЕМУ ИМПОРТ, А НЕ РЕГУЛЯРКА ═══
 *
 * Белый список — это `Map`. Выковыривать его регуляркой значило бы
 * держать второе, хрупкое представление тех же данных.
 * static-server.js защищён `isMainModule()`, поэтому импорт не
 * поднимает порт и безопасен.
 *
 * Запуск: node src/tools/audit-served-coverage.js
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED_FILES } from '../static-server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Взять граф продакшена у соседнего аудита — единый источник правды.
 * @returns {{browser: string[], node: string[], shared: string[], missing: string[]}}
 */
function productionGraph() {
  const out = execFileSync(
    process.execPath,
    [resolve(ROOT, 'src', 'tools', 'audit-production-graph.js'), '--json'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return JSON.parse(out);
}

/**
 * URL, по которым файл доступен (их может быть несколько — алиасы).
 * @param {string} diskPath путь относительно корня проекта
 * @returns {string[]}
 */
function urlsFor(diskPath) {
  const out = [];
  for (const [url, target] of ALLOWED_FILES) {
    if (target === diskPath) out.push(url);
  }
  return out;
}

function main() {
  const { browser, missing } = productionGraph();

  console.log('\n' + '='.repeat(70));
  console.log('  ОТДАЁТСЯ ЛИ ВСЁ, ЧТО НУЖНО БРАУЗЕРУ');
  console.log('='.repeat(70) + '\n');

  console.log(`  белый список сервера: ${ALLOWED_FILES.size} URL`);
  console.log(`  модулей у браузера:   ${browser.length}\n`);

  const notServed = [];

  for (const mod of browser) {
    const urls = urlsFor(mod);
    const ok = urls.length > 0;
    const suffix = ok ? `  (${urls.join(', ')})` : '  ← НЕТ В БЕЛОМ СПИСКЕ';
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${mod}${suffix}`);
    if (!ok) notServed.push(mod);
  }

  if (missing.length) {
    console.log('\n  битые импорты:');
    for (const m of missing) console.log(`  FAIL  ${m}`);
  }

  const fail = notServed.length + missing.length;

  console.log('\n' + '-'.repeat(70));
  console.log(`  пройдено: ${browser.length - notServed.length}`);
  console.log(`  провалено: ${fail}`);
  console.log('-'.repeat(70) + '\n');

  if (fail === 0) {
    console.log('  КАЖДЫЙ МОДУЛЬ, НУЖНЫЙ БРАУЗЕРУ, ОТДАЁТСЯ СЕРВЕРОМ.');
    console.log('  На хостинге не будет 404 на импортах, которые работали');
    console.log('  локально через dev-сервер.\n');
  } else {
    console.log('  ЧТО ДЕЛАТЬ: добавить путь в ALLOWED_FILES в');
    console.log('  src/static-server.js. Без этого страница на хостинге');
    console.log('  упадёт, хотя локально всё работает.\n');
  }

  process.exitCode = fail === 0 ? 0 : 1;
}

main();
