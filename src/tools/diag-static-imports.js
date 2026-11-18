/**
 * ДИАГНОСТИКА: почему страница не строит контролы через статик-сервер.
 *
 * ═══ СИМПТОМ ═══
 *
 * Через `src/server.js` (dev, 61 маршрут) страница работает.
 * Через `src/static-server.js` — DOM приходит, но контролы не
 * построены: EQ, микшер, сцены, mutes, loopback отсутствуют.
 *
 * Значит скрипт страницы не выполнился целиком.
 *
 * ═══ ВОЗМОЖНЫЕ ПРИЧИНЫ ═══
 *
 *   1. Какой-то модуль не отдан (404) — обрывается весь граф.
 *   2. CSP блокирует загрузку.
 *   3. content-type не тот, и браузер отказывается исполнять модуль.
 *   4. Синтаксическая ошибка в модуле.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Проверяет каждый импорт страницы на статус И content-type.
 * Модуль с неверным content-type браузер не исполнит, даже если
 * статус 200.
 *
 * Запуск: node src/tools/diag-static-imports.js [порт]
 */

import { request as httpRequest } from 'node:http';

const PORT = Number(process.argv[2]) || 8080;

function get(path) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: PORT, path, agent: false, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({
          status: res.statusCode,
          type: String(res.headers['content-type'] ?? ''),
          csp: String(res.headers['content-security-policy'] ?? ''),
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', () => done({ status: 0, type: '', csp: '', body: Buffer.alloc(0) }));
    req.on('timeout', () => { req.destroy(); done({ status: 0, type: '', csp: '', body: Buffer.alloc(0) }); });
    req.end();
  });
}

/** Достать все import-спецификаторы из JS-текста. */
function importsOf(src) {
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

async function main() {
  console.log(`статик-сервер на порту ${PORT}\n`);

  const page = await get('/');
  console.log(`страница: HTTP ${page.status}, ${page.type}, ${page.body.length} байт`);
  if (page.csp) console.log(`CSP: ${page.csp}`);
  console.log('');

  const html = page.body.toString('utf8');
  const specs = importsOf(html);
  console.log(`импортов на странице: ${specs.length}\n`);

  // Обходим граф рекурсивно
  const seen = new Set();
  const queue = [...specs];
  const problems = [];

  while (queue.length) {
    const spec = queue.shift();
    if (seen.has(spec)) continue;
    seen.add(spec);

    const r = await get(spec);
    const isJs = r.type.startsWith('text/javascript') || r.type.startsWith('application/javascript');
    const okStatus = r.status === 200;
    const okType = !spec.endsWith('.js') || isJs;
    const ok = okStatus && okType;

    const mark = ok ? 'OK  ' : 'FAIL';
    console.log(`  ${mark} ${String(r.status).padEnd(4)} ${r.type.padEnd(34)} ${spec}`);
    if (!ok) problems.push({ spec, status: r.status, type: r.type });

    // Рекурсия: импорты этого модуля
    if (okStatus && r.body.length) {
      for (const child of importsOf(r.body.toString('utf8'))) {
        if (child.startsWith('/') && !seen.has(child)) queue.push(child);
      }
    }
  }

  console.log(`\nвсего модулей в графе: ${seen.size}`);
  console.log(`проблем: ${problems.length}`);

  if (problems.length) {
    console.log('\nПРОБЛЕМНЫЕ:');
    for (const p of problems) {
      console.log(`  ${p.spec}: HTTP ${p.status}, type="${p.type}"`);
    }
    console.log(`
ЧТО ЭТО ЗНАЧИТ

Если модуль вернул не тот content-type, браузер откажется его
исполнять как ES-модуль — и весь граф страницы не выполнится.
Именно так выглядит «DOM есть, а контролы не построены».

Если 404 — модуля нет в белом списке static-server.js.
`);
  } else {
    console.log('\nвсе модули отдаются корректно');
  }
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
