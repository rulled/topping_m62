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

    // ─── 3. все импорты страницы отдаются ───
    console.log('\n--- 3. модули, которые импортирует страница ---');
    const html = page.body.toString('utf8');
    const specs = importsOf(html);
    check('импорты найдены', specs.length > 0, `${specs.length}`);

    const notServed = [];
    for (const spec of specs) {
      const r = await request(port, spec);
      if (r.status !== 200) notServed.push(`${spec} -> HTTP ${r.status}`);
    }
    check(
      `все ${specs.length} импортов отдаются`,
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

    // ─── 8. кэширование ───
    console.log('\n--- 8. кэширование ---');
    check('HTML не кэшируется', page.headers['cache-control'] === 'no-cache',
      String(page.headers['cache-control']));
    const mod = await request(port, '/src/protocol.js');
    check('модули кэшируются', String(mod.headers['cache-control']).includes('max-age'),
      String(mod.headers['cache-control']));
    check('модуль отдан как JS',
      String(mod.headers['content-type']).startsWith('text/javascript'));
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

