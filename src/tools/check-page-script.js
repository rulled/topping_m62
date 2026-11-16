/**
 * ПРОВЕРКА: встроенный скрипт страницы синтаксически корректен.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `web/index.html` — один файл, и весь клиент живёт в блоке
 * `<script type="module">`. Опечатка в нём ломает страницу целиком,
 * причём молча: браузер покажет пустые карточки, а ошибка уйдёт
 * в консоль, которую при headless-проверке не видно.
 *
 * `node --check` для HTML не работает, поэтому извлекаем скрипт
 * в отдельный модуль и проверяем его как модуль.
 *
 * ═══ ЧТО ИМЕННО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. блок <script type="module"> существует и не пуст;
 *   2. он парсится как ES-модуль (импорты разрешены);
 *   3. все id, которые скрипт ищет через $('...'), есть в разметке;
 *   4. все импортируемые модули существуют на диске.
 *
 * Пункт 3 особенно важен: `$('eqHpNote').textContent = ...` при
 * отсутствующем id даёт `null.textContent` в рантайме и убивает
 * рендер, но синтаксис остаётся целым.
 *
 * Запуск: node src/tools/check-page-script.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = 'web/index.html';
let ok = 0;
let fail = 0;

const check = (name, cond, detail = '') => {
  if (cond) {
    ok += 1;
    console.log(`  OK    ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
};

const html = readFileSync(PAGE, 'utf8');

// ─── 1. блок скрипта ───
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
check('блок <script type="module"> найден', !!m);
if (!m) {
  console.log('\nдальше проверять нечего');
  process.exit(1);
}
const js = m[1];
check('скрипт не пустой', js.trim().length > 500, `${js.trim().length} символов`);

// ─── 2. синтаксис ───
const tmp = join(tmpdir(), `m62-page-${process.pid}.mjs`);
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(tmp, js, 'utf8');
let syntaxErr = null;
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (err) {
  syntaxErr = String(err?.stderr ?? err?.message ?? err);
}
try { unlinkSync(tmp); } catch { /* уже */ }
check('скрипт парсится как ES-модуль', syntaxErr === null, syntaxErr?.split('\n').slice(0, 4).join(' '));

// ─── 3. импорты существуют ───
const imports = [...js.matchAll(/from\s+['"](\/src\/[^'"]+)['"]/g)].map((x) => x[1]);
check('импорты найдены', imports.length > 0, `${imports.length}`);
for (const spec of imports) {
  const rel = spec.replace(/^\//, '');
  check(`файл есть: ${spec}`, existsSync(rel));
}

// ─── 4. id из $('...') есть в разметке ───
//
// Ищем только литеральные вызовы $('id'). Динамические (`$(id)`)
// пропускаем — их нельзя проверить статически.
const ids = new Set([...js.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((x) => x[1]));
const idsDynamic = [...js.matchAll(/\$\(`([^`]*)`\)/g)].length;
check('id в разметке найдены', ids.size > 0, `${ids.size} литеральных, ${idsDynamic} динамических`);

const missing = [];
for (const id of [...ids].sort()) {
  const re = new RegExp(`id="${id}"`);
  if (!re.test(html)) missing.push(id);
}
check('все литеральные id есть в разметке', missing.length === 0, missing.join(', '));

console.log(`\n${'='.repeat(60)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
