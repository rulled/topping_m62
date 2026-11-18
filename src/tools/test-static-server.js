/**
 * ТЕСТ: статик-сервер отдаёт только разрешённое.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Статик-сервер для хостинга — единственная точка, которую увидит
 * интернет. Ошибка в нём означает либо утечку серверного кода, либо
 * неработающий сайт у пользователей.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Все файлы из белого списка реально существуют на диске
 *      (иначе сайт сломается в проде, а не в тесте).
 *   2. Страница отдаётся с правильным content-type.
 *   3. Все модули, которые импортирует страница, отдаются.
 *   4. Серверный код НЕ отдаётся (утечка).
 *   5. Обход каталога заблокирован.
 *   6. Заголовки безопасности на месте.
 *   7. Только GET/HEAD разрешены.
 *
 * ═══ ПОЧЕМУ НУЖЕН ЖИВОЙ СЕРВЕР ═══
 *
 * Проверяются реальные HTTP-ответы, а не только код. Это ловит
 * ошибки, которые статический анализ пропускает.
 *
 * Запуск: node src/tools/test-static-server.js
 */

import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';

import { ALLOWED_FILES, createStaticServer } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/**
 * Прочитать URL через голый http.
 *
 * ПОЧЕМУ НЕ fetch: глобальный fetch (undici) держит keep-alive
 * соединения, и процесс не завершается. Голый http с agent: false
 * закрывает сокет сам.
 */
function request(port, path, method = 'GET') {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, agent: false, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', () => done({ status: 0, headers: {}, body: Buffer.alloc(0) }));
    req.on('timeout', () => {
      req.destroy();
      done({ status: 0, headers: {}, body: Buffer.alloc(0) });
    });
    req.end();
  });
}

/** Извлечь импорты из HTML и JS. */
function importsOf(html) {
  const specs = [];
  for (const m of html.matchAll(/from\s+['"](\/[^'"]+)['"]/g)) specs.push(m[1]);
  return [...new Set(specs)];
}

async function main() {
  console.log('='.repeat(70));
  console.log('СТАТИК-СЕРВЕР: ПРОВЕРКА');
  console.log('='.repeat(70));

  // ─── 1. файлы белого списка существуют ───
  console.log('\n--- 1. файлы на диске ---');
  const missing = [];
  for (const [url, disk] of ALLOWED_FILES) {
    if (!existsSync(disk)) missing.push(`${url} -> ${disk}`);
  }
  check(
    `все ${ALLOWED_FILES.size} файлов из белого списка существуют`,
    missing.length === 0,
    missing.join(', '),
  );

  // ─── поднимаем сервер на случайном порту ───
  const server = createStaticServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log(`\n  сервер слушает порт ${port}`);

  try {
    // ─── 2. страница ───
    console.log('\n--- 2. страница ---');
    const page = await request(port, '/');
    check('GET / -> 200', page.status === 200, `HTTP ${page.status}`);
    check(
      'content-type страницы: text/html',
      String(page.headers['content-type']).startsWith('text/html'),
      String(page.headers['content-type']),
    );
    check('страница не пустая', page.body.length > 10000, `${page.body.length} байт`);

    // ─── 3. все модули графа отдаются ───
    //
    // Раньше импорты были прямо в HTML. Теперь клиент вынесен в
    // app.js, поэтому граф обходим рекурсивно от него: один
    // недоступный модуль обрывает выполнение всей страницы.
    console.log('\n--- 3. модули графа страницы ---');
    const html = page.body.toString('utf8');

    const appTagMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
    check('страница подключает скрипт файлом', !!appTagMatch);
    const entry = appTagMatch?.[1] ?? '/web/app.js';

    const entryRes = await request(port, entry);
    check(`входной скрипт отдаётся (${entry})`, entryRes.status === 200,
      `HTTP ${entryRes.status}`);

    // Обход графа
    const seen = new Set();
    const queue = importsOf(entryRes.body.toString('utf8'));
    const notServed = [];

    while (queue.length) {
      const spec = queue.shift();
      if (seen.has(spec)) continue;
      seen.add(spec);
      const r = await request(port, spec);
      if (r.status !== 200) {
        notServed.push(`${spec} -> HTTP ${r.status}`);
        continue;
      }
      for (const child of importsOf(r.body.toString('utf8'))) {
        if (child.startsWith('/') && !seen.has(child)) queue.push(child);
      }
    }

    check('граф модулей найден', seen.size > 0, `${seen.size}`);
    check(
      `все ${seen.size} модулей графа отдаются`,
      notServed.length === 0,
      notServed.join(', '),
    );

    // ─── 4. утечки серверного кода ───
    console.log('\n--- 4. серверный код НЕ должен отдаваться ---');
    const secret = [
      '/src/server.js',
      '/src/transport.js',
      '/src/workspace.js',
      '/src/ui-control.js',
      '/src/state-store.js',
      '/src/tools/test-ui-frames.js',
      '/package.json',
      '/.gitignore',
      '/.env',
    ];
    const leaked = [];
    for (const path of secret) {
      const r = await request(port, path);
      if (r.status === 200) leaked.push(path);
    }
    check(`ни один из ${secret.length} служебных путей не отдан`,
      leaked.length === 0, leaked.join(', '));

    // ─── 5. обход каталога ───
    console.log('\n--- 5. обход каталога ---');
    const traversal = [
      '/../package.json',
      '/src/../package.json',
      '/%2e%2e/package.json',
      '/src/../../etc/passwd',
    ];
    const traversed = [];
    for (const path of traversal) {
      const r = await request(port, path);
      if (r.status === 200) traversed.push(path);
    }
    check('обход каталога заблокирован', traversed.length === 0, traversed.join(', '));

    // ─── 6. заголовки безопасности ───
    console.log('\n--- 6. заголовки безопасности ---');
    check('есть content-security-policy',
      !!page.headers['content-security-policy']);
    check('CSP запрещает внешние скрипты',
      String(page.headers['content-security-policy']).includes("script-src 'self'"));
    check('есть x-content-type-options: nosniff',
      page.headers['x-content-type-options'] === 'nosniff');
    check('есть x-frame-options: DENY',
      page.headers['x-frame-options'] === 'DENY');
    check('есть referrer-policy', !!page.headers['referrer-policy']);

    // ─── 7. методы ───
    console.log('\n--- 7. HTTP-методы ---');
    const post = await request(port, '/', 'POST');
    check('POST отклонён (405)', post.status === 405, `HTTP ${post.status}`);
    const head = await request(port, '/', 'HEAD');
    check('HEAD работает (200)', head.status === 200, `HTTP ${head.status}`);
    check('HEAD без тела', head.body.length === 0, `${head.body.length} байт`);

    // ─── 9. CSP-совместимость страницы ───
    //
    // ГЛАВНАЯ ПРОВЕРКА. Однажды уже случилось: страница содержала
    // встроенный <script type="module"> на 40 КБ, CSP `script-src
    // 'self'` его блокировал, и страница не выполнялась вовсе —
    // при этом DOM приходил, и всё выглядело как «пустые карточки».
    //
    // Проверяем, что такого больше нет.
    console.log('\n--- 9. CSP-совместимость страницы ---');
    const pageHtml = page.body.toString('utf8');
    const csp = String(page.headers['content-security-policy'] ?? '');
    const noUnsafeInline = csp.includes("script-src 'self'")
      && !csp.includes("script-src 'self' 'unsafe-inline'");
    check('CSP не разрешает unsafe-inline для скриптов', noUnsafeInline, csp);

    const inline = [...pageHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .filter((m) => m[1].trim().length > 0);
    check('в странице нет инлайн-скриптов (иначе CSP их убьёт)',
      inline.length === 0,
      `найдено ${inline.length}`);

    // Скрипт подключён файлом — и этот файл отдаётся.
    const appMatch = pageHtml.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
    check('страница подключает модульный скрипт файлом', !!appMatch);
    if (appMatch) {
      const appRes = await request(port, appMatch[1]);
      check(`скрипт страницы отдаётся (${appMatch[1]})`, appRes.status === 200,
        `HTTP ${appRes.status}`);
    }

    // ─── 10. кэширование ───
    console.log('\n--- 10. кэширование ---');
    check('HTML не кэшируется', page.headers['cache-control'] === 'no-cache',
      String(page.headers['cache-control']));
    const mod = await request(port, '/src/protocol.js');
    check('модули кэшируются', String(mod.headers['cache-control']).includes('max-age'),
      String(mod.headers['cache-control']));
    check('модуль отдан как JS',
      String(mod.headers['content-type']).startsWith('text/javascript'));

    // ─── 11. BOM ───
    //
    // PowerShell при Set-Content -Encoding UTF8 добавляет BOM в начало
    // файла. Для JSON это фатально (npm не читает package.json), для
    // JS-модулей — нежелательно. Однажды это уже случилось с 16 файлами.
    //
    // Проверяем, что ни один отдаваемый файл не начинается с BOM.
    console.log('\n--- 11. BOM в отдаваемых файлах ---');
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    const withBom = [];
    for (const [url] of ALLOWED_FILES) {
      const r = await request(port, url);
      if (r.status === 200 && r.body.subarray(0, 3).equals(BOM)) {
        withBom.push(url);
      }
    }
    check('ни один отдаваемый файл не начинается с BOM',
      withBom.length === 0, withBom.join(', '));
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка теста:', e?.message ?? e);
  process.exitCode = 1;
});


