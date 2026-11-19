/**
 * ПРОВЕРКА: РАБОТАЕТ ЛИ САЙТ НА «ГЛУПОМ» СТАТИЧЕСКОМ ХОСТИНГЕ.
 *
 * ═══ ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ test-static-server.js ═══
 *
 * Наш `src/static-server.js` умеет алиасы: он отдаёт `/app.js` из
 * `web/app.js` и `/` из `web/index.html`. Поэтому на нём сайт
 * работает.
 *
 * Но GitHub Pages, Cloudflare Pages, Netlify и любой `npx serve`
 * так НЕ умеют: они отдают ровно то, что лежит на диске. Никаких
 * алиасов — файл по URL /app.js должен лежать в корне.
 *
 * Значит проверка на нашем сервере НЕ доказывает, что сайт заработает
 * на хостинге. Этот скрипт проверяет именно второй случай: раздаёт
 * каталог как есть и смотрит, что получится.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Открывается ли корень `/` (главная страница).
 *   2. Разрешаются ли ВСЕ импорты страницы по относительным путям.
 *   3. Нет ли абсолютных путей `/src/...` — они ломаются в подкаталоге.
 *
 * Запуск: node src/tools/check-plain-static-hosting.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Расширение -> Content-Type, как у типичного статик-хостинга. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Импорты в файле. */
const REL = /from\s+['"](\.[^'"]+)['"]/g;

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/**
 * Тупо раздать каталог: ни алиасов, ни переписывания путей.
 * Именно так ведёт себя GitHub Pages.
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
function plainServer(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Защита от выхода за корень — единственная «умная» часть.
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, rel);

    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404');
      return;
    }

    const body = readFileSync(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
    });
    res.end(body);
  });

  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

/**
 * GET по адресу, вернуть статус и текст.
 * @param {string} url
 * @returns {Promise<{status: number, body: string}>}
 */
async function get(url) {
  try {
    const r = await fetch(url);
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

const PORT = 8896;

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  САЙТ НА «ГЛУПОМ» СТАТИКЕ (как GitHub Pages / Cloudflare)');
  console.log('='.repeat(70) + '\n');

  const server = await plainServer(PORT);
  const base = `http://127.0.0.1:${PORT}`;

  try {
    // ─── 1. главная страница ───
    console.log('--- 1. главная страница ---');
    const root = await get(`${base}/`);
    check('GET / отдаёт HTML', root.status === 200 && root.body.includes('<html'),
      `HTTP ${root.status}, ${root.body.length} байт`);

    const page = await get(`${base}/index.html`);
    check('GET /index.html отдаёт страницу',
      page.status === 200 && page.body.includes('<html'),
      `HTTP ${page.status}`);

    if (root.status !== 200) {
      console.log('\n  !  ВАЖНО: корень не отдаёт страницу.');
      console.log('     Статический хостинг ищет index.html в КОРНЕ репозитория.');
      console.log('     Если страница лежит в подкаталоге, сайт откроется');
      console.log('     только по этому подкаталогу, а корень будет 404.');
    }

    // ─── 2. импорты разрешаются ───
    console.log('\n--- 2. импорты страницы по относительным путям ---');

    // Страница в корне, поэтому все её ссылки считаются от корня.
    const html = page.body || readFileSync(join(ROOT, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((s) => s.startsWith('.'));

    const queue = scripts.map((s) => `/${s.replace(/^\.\//, '')}`);
    const seen = new Set();
    const missing = [];

    while (queue.length) {
      const path = /** @type {string} */ (queue.shift());
      if (seen.has(path)) continue;
      seen.add(path);

      const res = await get(base + path);
      if (res.status !== 200) {
        missing.push(path);
        continue;
      }

      // Только js разбираем на импорты.
      if (!path.endsWith('.js')) continue;

      const dir = path.slice(0, path.lastIndexOf('/'));
      for (const m of res.body.matchAll(REL)) {
        // Собираем путь так же, как это сделал бы браузер.
        const target = new URL(m[1], `http://x${dir}/`).pathname;
        if (!seen.has(target)) queue.push(target);
      }
    }

    check(`все импорты разрешаются (${seen.size} файлов)`, missing.length === 0,
      missing.length ? `не найдено: ${missing.join(', ')}` : 'все 200');

    // ─── 3. абсолютные пути ───
    console.log('\n--- 3. абсолютные пути ---');
    const appjs = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const absImports = [...appjs.matchAll(/from\s+['"](\/(?:src|web)\/[^'"]+)['"]/g)];
    check('нет абсолютных импортов /src/...', absImports.length === 0,
      absImports.length ? `${absImports.length} шт` : 'все относительные');

    console.log('\n' + '-'.repeat(70));
    console.log(`  пройдено: ${ok}`);
    console.log(`  провалено: ${fail}`);
    console.log('-'.repeat(70) + '\n');

    if (fail === 0) {
      console.log('  НА ЧИСТОМ СТАТИКЕ САЙТ РАБОТАЕТ.');
      console.log('  Модули находятся по относительным путям, алиасы не нужны.\n');
    } else {
      console.log('  ЕСТЬ ПРОБЛЕМЫ ДЛЯ ЧИСТОГО ХОСТИНГА.');
      console.log('  Наш сервер умеет алиасы, GitHub Pages — нет.\n');
    }

    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
