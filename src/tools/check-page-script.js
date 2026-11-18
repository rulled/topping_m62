/**
 * ПРОВЕРКА: клиентский скрипт страницы корректен.
 *
 * ═══ ЧТО ИЗМЕНИЛОСЬ ═══
 *
 * Раньше весь клиент лежал встроенным `<script type="module">` внутри
 * `web/index.html`. Теперь он вынесен в `web/app.js` — потому что CSP
 * `script-src 'self'` блокирует инлайн-скрипты, и на продакшн-сервере
 * страница не выполнялась вовсе.
 *
 * Тест переписан под новую структуру. Заодно он стал строже: теперь
 * проверяется ещё и CSP-совместимость разметки.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. В HTML нет инлайн-скриптов (иначе CSP их заблокирует).
 *   2. Скрипт подключён как отдельный файл и этот файл существует.
 *   3. `app.js` парсится как ES-модуль.
 *   4. Все импортируемые модули существуют на диске.
 *   5. Все литеральные `$('id')` есть в разметке.
 *
 * Запуск: node src/tools/check-page-script.js
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = 'web/index.html';
const APP = 'web/app.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

const html = readFileSync(PAGE, 'utf8');

// ─── 1. нет инлайн-скриптов ───
//
// Регулярка ищет <script ...> без src. Именно такой блок CSP
// заблокирует, и страница молча не выполнится.
console.log('\n--- 1. CSP-совместимость разметки ---');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .filter((m) => m[1].trim().length > 0);

check(
  'в HTML нет инлайн-скриптов (CSP их блокирует)',
  inlineScripts.length === 0,
  `найдено ${inlineScripts.length}, первый: ${inlineScripts[0]?.[1].trim().slice(0, 40)}…`,
);

// ─── 2. скрипт подключён файлом ───
console.log('\n--- 2. подключение скрипта ---');
const appTag = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
check('страница подключает модульный скрипт файлом', !!appTag);
check('это /web/app.js', appTag?.[1] === '/web/app.js', String(appTag?.[1]));
check('файл app.js существует', existsSync(APP));

if (!existsSync(APP)) {
  console.log('\nдальше проверять нечего');
  process.exit(1);
}

// ─── 3. синтаксис ───
console.log('\n--- 3. синтаксис ---');
const js = readFileSync(APP, 'utf8');
check('скрипт не пустой', js.trim().length > 500, `${js.trim().length} символов`);

const tmp = join(tmpdir(), `m62-app-${process.pid}.mjs`);
writeFileSync(tmp, js, 'utf8');
let syntaxErr = null;
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (err) {
  syntaxErr = String(err?.stderr ?? err?.message ?? err);
}
try { unlinkSync(tmp); } catch { /* уже */ }
check('парсится как ES-модуль', syntaxErr === null,
  syntaxErr?.split('\n').slice(0, 4).join(' '));

// ─── 4. импорты существуют ───
console.log('\n--- 4. импорты ---');
const imports = [...js.matchAll(/from\s+['"](\/(?:src|web)\/[^'"]+)['"]/g)].map((x) => x[1]);
check('импорты найдены', imports.length > 0, `${imports.length}`);
for (const spec of imports) {
  const rel = spec.replace(/^\//, '');
  check(`файл есть: ${spec}`, existsSync(rel));
}

// ─── 5. id из $('...') есть в разметке ───
console.log('\n--- 5. id контролов ---');
const ids = new Set([...js.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((x) => x[1]));
check('id в разметке найдены', ids.size > 0, `${ids.size}`);

const missing = [];
for (const id of [...ids].sort()) {
  if (!new RegExp(`id="${id}"`).test(html)) missing.push(id);
}
check('все литеральные id есть в разметке', missing.length === 0, missing.join(', '));

console.log(`\n${'='.repeat(60)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
