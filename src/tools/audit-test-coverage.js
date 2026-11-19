/**
 * ПОКРЫТИЕ ТЕСТАМИ ТОГО, ЧТО УЕЗЖАЕТ НА ХОСТИНГ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * «Модулей 38, тестов 28» — бесполезная цифра: в src/ лежит код
 * dev-фазы и реверса, который на сайт не попадает. Мерить надо по
 * графу продакшена.
 *
 * ═══ КАК СЧИТАЕТСЯ ═══
 *
 * Для каждого модуля браузерного графа ищутся тесты (test-*.js,
 * audit-*.js, check-*.js, verify-*.js, prove-*.js), которые его
 * УПОМИНАЮТ. Это грубая, но честная мера: упоминание файла значит,
 * что тест его импортирует или проверяет.
 *
 * Модули без упоминаний перечисляются поимённо — это список
 * кандидатов, а не приговор: часть покрыта косвенно через сервер.
 *
 * Запуск: node src/tools/audit-test-coverage.js [--verbose]
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = resolve(ROOT, 'src', 'tools');

/** Префиксы файлов, которые считаются проверками. */
const CHECK_PREFIXES = ['test-', 'audit-', 'check-', 'verify-', 'prove-', 'probe-'];

/**
 * Взять браузерный граф у соседнего аудита.
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

/** Все файлы проверок. */
function checkFiles() {
  return readdirSync(TOOLS)
    .filter((f) => f.endsWith('.js') && CHECK_PREFIXES.some((p) => f.startsWith(p)))
    .sort();
}

/**
 * Содержимое проверок — читаем один раз, а не для каждого модуля.
 * @returns {Map<string, string>}
 */
function checkContents() {
  const map = new Map();
  for (const f of checkFiles()) {
    map.set(f, readFileSync(resolve(TOOLS, f), 'utf8'));
  }
  return map;
}

/**
 * Упоминается ли модуль в проверках.
 * @param {string} mod путь относительно корня
 * @param {Map<string, string>} contents
 * @returns {string[]} имена проверок, где он упомянут
 */
function findTests(mod, contents) {
  const base = mod.split('/').pop();
  if (!base) return [];
  const hits = [];
  for (const [name, text] of contents) {
    // Ищем имя файла модуля — так работает и прямой импорт,
    // и проверка вида readFileSync('src/x.js').
    if (text.includes(base)) hits.push(name);
  }
  return hits;
}

function main() {
  const verbose = process.argv.includes('--verbose');
  const { browser } = productionGraph();
  const contents = checkContents();

  console.log('\n' + '='.repeat(70));
  console.log('  ПОКРЫТИЕ ТЕСТАМИ: ТОЛЬКО ТО, ЧТО УЕЗЖАЕТ НА ХОСТИНГ');
  console.log('='.repeat(70) + '\n');

  console.log(`  модулей в браузерном графе: ${browser.length}`);
  console.log(`  файлов проверок:            ${contents.size}\n`);

  const covered = [];
  const uncovered = [];

  for (const mod of browser) {
    const tests = findTests(mod, contents);
    if (tests.length) covered.push([mod, tests]);
    else uncovered.push(mod);
  }

  console.log('  ПОКРЫТЫ:');
  for (const [mod, tests] of covered) {
    const list = verbose ? tests.join(', ') : `${tests.length} проверок`;
    console.log(`    OK    ${mod.padEnd(30)} ${list}`);
  }

  if (uncovered.length) {
    console.log('\n  БЕЗ ПРОВЕРОК:');
    for (const mod of uncovered) {
      console.log(`    —     ${mod}`);
    }
  }

  const pct = Math.round((covered.length / browser.length) * 100);

  console.log('\n' + '-'.repeat(70));
  console.log(`  покрыто: ${covered.length} из ${browser.length}  (${pct}%)`);
  console.log(`  без проверок: ${uncovered.length}`);
  console.log('-'.repeat(70) + '\n');

  if (uncovered.length) {
    console.log('  Модули без проверок — кандидаты на тесты. Не все одинаково');
    console.log('  важны: чистая логика (шкалы, кадры) тестируется легко и');
    console.log('  ловит регрессии, а рендер страницы всё равно требует');
    console.log('  браузера с реальной картой.\n');
  }

  // Код возврата не ноль: список — повод посмотреть, а не запрет.
  process.exitCode = 0;
}

main();
