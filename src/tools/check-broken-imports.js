/**
 * ТРАНЗИТИВНЫЙ ГРАФ: что в src/ осталось без своих зависимостей.
 *
 * ═══ КАКАЯ ОШИБКА ЛОВИТСЯ ═══
 *
 * При переносе dev-сервера в research/dev-server/ легко смотреть
 * только на прямые импорты server.js. Но модуль, оставшийся в src/,
 * может сам импортировать перенесённый — например src/snapshots.js
 * импортировал workspace.js.
 *
 * В результате src/ формально цел, но модули ссылаются на
 * несуществующие файлы, и ошибка вылезает только при запуске.
 *
 * ═══ ПОЧЕМУ ПРОПУСКАЮТСЯ КОММЕНТАРИИ ═══
 *
 * Первая версия находила «импорты» в тексте JSDoc: примеры вида
 * `from './x.js'` в документации. Это ложные срабатывания — файлы
 * проверки сами содержат образцы путей.
 *
 * Поэтому строки-комментарии (`//`, `*`) отбрасываются до поиска.
 *
 * Запуск: node src/tools/check-broken-imports.js
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const REL = /from\s+['"](\.[^'"]+)['"]/g;

/**
 * Убрать строки-комментарии, чтобы примеры в JSDoc не считались
 * импортами.
 *
 * Блочные комментарии обрабатываются построчно: строка внутри
 * `/** ... *\/` начинается с `*` или `/*`, такие отбрасываем.
 *
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//')) continue;
    out.push(raw);
  }
  return out.join('\n');
}

/**
 * Все js-файлы в каталоге (без подкаталогов).
 * @param {string} dir
 * @returns {string[]}
 */
function jsFiles(dir) {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(resolve(abs, entry.name));
  }
  return out;
}

/**
 * Файлы в src/tools.
 * @returns {string[]}
 */
function toolFiles() {
  const abs = resolve(ROOT, 'src', 'tools');
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith('.js')).map((f) => resolve(abs, f));
}

function main() {
  const files = [...jsFiles('src'), ...jsFiles('web'), ...toolFiles()];

  console.log('\n' + '='.repeat(70));
  console.log('  БИТЫЕ ОТНОСИТЕЛЬНЫЕ ИМПОРТЫ В АКТИВНОМ КОДЕ');
  console.log('='.repeat(70) + '\n');

  const broken = [];
  let total = 0;

  for (const abs of files) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const m of stripComments(text).matchAll(REL)) {
      total += 1;
      if (!existsSync(resolve(dirname(abs), m[1]))) {
        broken.push([relative(ROOT, abs).replace(/\\/g, '/'), m[1]]);
      }
    }
  }

  console.log(`  проверено файлов: ${files.length}`);
  console.log(`  относительных импортов: ${total}\n`);

  if (broken.length === 0) {
    console.log('  БИТЫХ ИМПОРТОВ НЕТ.');
    console.log('  Каждый модуль активного кода находит свои зависимости.\n');
    process.exitCode = 0;
    return;
  }

  const byFile = new Map();
  for (const [file, spec] of broken) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(spec);
  }

  for (const [file, specs] of byFile) {
    console.log(`  ${file}`);
    for (const s of specs) console.log(`      -> ${s}  НЕ НАЙДЕН`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`  проверено файлов: ${files.length}`);
  console.log(`  битых: ${broken.length} в ${byFile.size} файлах`);
  console.log('-'.repeat(70) + '\n');
  console.log('  ЧТО ДЕЛАТЬ: либо файл-цель должен вернуться в src/,');
  console.log('  либо модуль-источник тоже относится к dev-фазе и должен');
  console.log('  уехать в research/dev-server/.\n');

  process.exitCode = 1;
}

main();
