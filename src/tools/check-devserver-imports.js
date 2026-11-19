/**
 * ПРОВЕРКА: ВСЕ ИМПОРТЫ В research/dev-server/ РАЗРЕШАЮТСЯ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * После переноса dev-сервера в research/ пути пришлось удлинять
 * (`./x.js` -> `../../src/x.js`). Ошибка в одном символе даёт
 * ERR_MODULE_NOT_FOUND, но только при ЗАПУСКЕ — а сервер запускают
 * редко, и поломка всплывёт через месяцы.
 *
 * Поэтому здесь статическая проверка: для каждого относительного
 * импорта файл обязан существовать. Сам сервер не запускается —
 * проверка быстрая и не поднимает порт.
 *
 * Запуск: node src/tools/check-devserver-imports.js
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEV = resolve(ROOT, 'research', 'dev-server');

/** `from './x.js'` / `from '../x.js'` — только относительные. */
const REL = /from\s+['"](\.[^'"]+)['"]/g;

/**
 * Все js-файлы в каталоге.
 * @returns {string[]}
 */
function jsFiles() {
  if (!existsSync(DEV)) return [];
  return readdirSync(DEV).filter((f) => f.endsWith('.js')).sort();
}

function main() {
  const files = jsFiles();

  console.log('\n' + '='.repeat(70));
  console.log('  ИМПОРТЫ В research/dev-server/');
  console.log('='.repeat(70) + '\n');

  if (files.length === 0) {
    console.log('  каталог пуст или отсутствует — проверять нечего\n');
    process.exitCode = 0;
    return;
  }

  let total = 0;
  let bad = 0;

  for (const name of files) {
    const abs = resolve(DEV, name);
    const src = readFileSync(abs, 'utf8');
    const problems = [];

    for (const m of src.matchAll(REL)) {
      const spec = m[1];
      total += 1;
      const target = resolve(dirname(abs), spec);
      if (!existsSync(target)) problems.push(spec);
    }

    if (problems.length) {
      bad += problems.length;
      console.log(`  FAIL  ${name}`);
      for (const p of problems) console.log(`          ${p}`);
    } else {
      console.log(`  OK    ${name}`);
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`  файлов: ${files.length}`);
  console.log(`  относительных импортов: ${total}`);
  console.log(`  битых: ${bad}`);
  console.log('-'.repeat(70) + '\n');

  if (bad === 0) {
    console.log('  ВСЕ ИМПОРТЫ РАЗРЕШАЮТСЯ.');
    console.log('  Перенос в research/ не сломал пути.\n');
  } else {
    console.log('  ЧТО ДЕЛАТЬ: поправить пути в перечисленных файлах.');
    console.log('  Из research/dev-server/ до src/ — два уровня вверх:');
    console.log('  к имени файла добавить префикс с двумя ".." и src/.\n');
  }

  process.exitCode = bad === 0 ? 0 : 1;
}

main();
