/**
 * ПРОВЕРКА: документы не ссылаются на несуществующие файлы.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * После ревизии 492 скрипта уехали в `research/archive/tools/`, а
 * документы продолжали на них ссылаться. Читатель открывает
 * документацию, идёт по ссылке — и получает ничего.
 *
 * Это хуже отсутствия ссылки: создаётся впечатление, что скрипт
 * есть, просто «не нашёл».
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Все пути вида `src/tools/<файл>` в документации существуют.
 *   2. Все пути вида `docs/<файл>.md` существуют.
 *   3. Все относительные ссылки в markdown-таблицах существуют.
 *
 * Если файл перенесён в архив — надо либо обновить путь, либо убрать
 * ссылку, либо пометить как «в архиве».
 *
 * Запуск: node src/tools/check-doc-links.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `\n         ${detail}` : ''}`); }
};

/**
 * Документы, которые НЕ проверяем на актуальность ссылок.
 *
 * `research/NOTES.md` — датированный журнал работ на 648 КБ: записи
 * вида «2026-11-07 обновил docs/FOR-DESIGNER.md». Это исторический
 * факт, а не действующая ссылка: файл с тех пор переименован и
 * удалён, но запись об этом остаётся верной.
 *
 * Проверять журнал на живые ссылки значило бы требовать переписать
 * историю. При этом остальные документы research/ проверяются как
 * обычно — они описывают текущее состояние.
 */
const HISTORICAL = new Set(['research/NOTES.md']);

/** Все документы, которые проверяем. */
function docs() {
  const out = [];
  for (const dir of ['docs', 'research', '.']) {
    for (const f of globSync(`${dir}/*.md`)) out.push(f);
  }
  return [...new Set(out)]
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !f.includes('archive') && !HISTORICAL.has(f));
}

/** Есть ли файл, в том числе в архиве. */
function existsAnywhere(rel) {
  if (existsSync(rel)) return 'ok';
  const base = rel.split('/').pop();
  // Проверяем, не уехал ли он в архив
  const inArchive = globSync(`research/archive/**/${base}`).length > 0;
  return inArchive ? 'archive' : 'missing';
}

function main() {
  console.log('='.repeat(70));
  console.log('ССЫЛКИ В ДОКУМЕНТАЦИИ');
  console.log('='.repeat(70));

  const files = docs();
  console.log(`\nпроверяю документов: ${files.length}`);

  // ─── 1. ссылки на src/tools/* ───
  console.log('\n--- 1. ссылки на src/tools/* ---');
  const missing = [];
  const archived = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /src\/tools\/([a-zA-Z0-9_.-]+\.(?:js|py|ps1))/g;
    for (const m of src.matchAll(re)) {
      const rel = `src/tools/${m[1]}`;
      const state = existsAnywhere(rel);
      if (state === 'archive') archived.push(`${f}: ${rel}`);
      else if (state === 'missing') missing.push(`${f}: ${rel}`);
    }
  }

  check('нет ссылок на полностью отсутствующие скрипты',
    missing.length === 0, missing.slice(0, 10).join('\n         '));
  if (missing.length > 10) console.log(`         ... ещё ${missing.length - 10}`);

  check('нет ссылок на скрипты, уехавшие в архив',
    archived.length === 0, archived.slice(0, 10).join('\n         '));
  if (archived.length > 10) console.log(`         ... ещё ${archived.length - 10}`);

  // ─── 2. ссылки на docs/*.md ───
  console.log('\n--- 2. ссылки на docs/*.md ---');
  const missingDocs = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /docs\/([A-Za-z0-9_-]+\.md)/g;
    for (const m of src.matchAll(re)) {
      const rel = `docs/${m[1]}`;
      if (!existsSync(rel)) missingDocs.push(`${f}: ${rel}`);
    }
  }
  check('все ссылки на docs/*.md существуют', missingDocs.length === 0,
    [...new Set(missingDocs)].slice(0, 10).join('\n         '));

  // ─── 3. файлы в docs/ упомянуты в INDEX ───
  //
  // В INDEX.md ссылки ОТНОСИТЕЛЬНЫЕ (просто `API.md`), потому что он
  // лежит в той же папке. Поэтому ищем имя файла, а не путь с
  // префиксом `docs/`.
  console.log('\n--- 3. все документы есть в индексе ---');
  const index = existsSync('docs/INDEX.md') ? readFileSync('docs/INDEX.md', 'utf8') : '';
  const notIndexed = [];
  for (const f of globSync('docs/*.md')) {
    const name = f.split(/[\\/]/).pop();
    if (name === 'INDEX.md') continue;
    if (!index.includes(name)) notIndexed.push(name);
  }
  check('все документы из docs/ упомянуты в INDEX.md',
    notIndexed.length === 0, notIndexed.join(', '));

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);

  if (fail > 0) {
    console.log(`
  ЧТО ДЕЛАТЬ

  Ссылка на скрипт в архиве: либо заменить путь на
  research/archive/tools/<файл>, либо убрать ссылку из документа.

  Ссылка на отсутствующий скрипт: скрипт удалён — убрать упоминание.
`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main();
