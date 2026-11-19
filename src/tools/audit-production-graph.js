/**
 * ГРАФ МОДУЛЕЙ ПРОДАКШЕНА, РАЗДЕЛЁННЫЙ ПО СРЕДАМ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * В src/ 38 модулей: часть — рабочий код сайта, часть осталась от
 * dev-фазы и реверса (elevate.js, workspace-service.js, settings.js —
 * они управляют локальным приложением Topping и в браузере не нужны).
 *
 * Считать «сколько модулей покрыто тестами» по всем 38 — значит
 * мерить прогресс по мёртвому коду. Нужно мерить по тому, что
 * реально уезжает на хостинг.
 *
 * ═══ ПОЧЕМУ СРЕДЫ РАЗДЕЛЕНЫ ═══
 *
 * Серверный модуль НЕ должен отдаваться браузеру — в этом весь смысл
 * белого списка. Поэтому `src/static-server.js` не проверяется на
 * «отдаётся ли он»: он и есть сервер.
 *
 * А вот всё, что достижимо из `app.js`, браузер обязан получить
 * по HTTP, иначе страница упадёт с 404.
 *
 * ═══ КАК СЧИТАЕТСЯ ═══
 *
 * Два независимых обхода:
 *   browser — от app.js (то, что грузит браузер)
 *   node    — от src/static-server.js (то, что крутится на сервере)
 *
 * Запуск: node src/tools/audit-production-graph.js [--json]
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Точка входа браузера: её грузит страница по HTTP. */
const BROWSER_ENTRIES = ['app.js'];

/** Точки входа сервера: запускаются в Node. */
const NODE_ENTRIES = ['src/static-server.js'];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;

/**
 * Прочитать импорты файла.
 * @param {string} abs абсолютный путь
 * @returns {string[]} пути относительно корня проекта
 */
function importsOf(abs) {
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // пакет из node_modules
    out.push(relative(ROOT, resolve(dirname(abs), spec)).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * Обойти граф в ширину от набора точек входа.
 * @param {string[]} entries
 * @returns {{modules: string[], missing: string[]}}
 */
function walk(entries) {
  const seen = new Set();
  const missing = [];
  const queue = [...entries];

  while (queue.length) {
    const rel = /** @type {string} */ (queue.shift());
    if (seen.has(rel)) continue;
    seen.add(rel);

    const abs = resolve(ROOT, rel);
    let exists = true;
    try {
      readFileSync(abs);
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(rel);
      continue;
    }
    for (const dep of importsOf(abs)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }

  return { modules: [...seen].sort(), missing };
}

/**
 * Размер файла в байтах (0, если не читается).
 * @param {string} rel
 * @returns {number}
 */
function sizeOf(rel) {
  try {
    return readFileSync(resolve(ROOT, rel)).length;
  } catch {
    return 0;
  }
}

function main() {
  const asJson = process.argv.includes('--json');

  const browser = walk(BROWSER_ENTRIES);
  const node = walk(NODE_ENTRIES);

  // Модуль может быть в обеих средах (shared-код).
  const browserSet = new Set(browser.modules);
  const nodeSet = new Set(node.modules);
  const shared = [...browserSet].filter((m) => nodeSet.has(m)).sort();

  const result = {
    browser: browser.modules,
    node: node.modules,
    shared,
    missing: [...new Set([...browser.missing, ...node.missing])],
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.missing.length ? 1 : 0;
    return;
  }

  console.log('\n' + '='.repeat(70));
  console.log('  ГРАФ МОДУЛЕЙ ПРОДАКШЕНА');
  console.log('='.repeat(70) + '\n');

  const print = (title, entries, mods) => {
    console.log(`  ${title} — ${mods.length} модулей`);
    console.log(`  точки входа: ${entries.join(', ')}`);
    for (const m of mods) {
      const mark = shared.includes(m) ? 'общий' : '     ';
      console.log(`    ${mark}  ${m.padEnd(32)} ${String(sizeOf(m)).padStart(6)} байт`);
    }
    console.log('');
  };

  print('БРАУЗЕР (грузится по HTTP)', BROWSER_ENTRIES, browser.modules);
  print('NODE (крутится на сервере)', NODE_ENTRIES, node.modules);

  console.log(`  общих модулей: ${shared.length}`);
  console.log(`  всего уникальных: ${new Set([...browserSet, ...nodeSet]).size}`);

  if (result.missing.length) {
    console.log('\n  БИТЫЕ ИМПОРТЫ:');
    for (const m of result.missing) console.log(`    ${m}`);
  }

  console.log('');
  process.exitCode = result.missing.length ? 1 : 0;
}

main();
