/**
 * ТЕСТ: работа за обратным прокси.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * В продакшене сервер почти всегда стоит за прокси: nginx, Caddy,
 * Cloudflare. Прокси добавляет заголовки и передаёт свои.
 *
 * Типичные ошибки, которые ловятся только здесь:
 *   • заголовок безопасности дублируется (браузер применяет оба и
 *     выбирает самый строгий — иногда ломая сайт);
 *   • `content-length` не совпадает с телом после сжатия;
 *   • прокси просит gzip, а сервер отдаёт несжатый ответ;
 *   • `X-Forwarded-Proto` игнорируется, и сервер не знает про HTTPS.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Сервер не падает от заголовков прокси.
 *   2. Заголовки безопасности ровно по одному (не дублируются).
 *   3. content-length совпадает с реальной длиной тела.
 *   4. Сжатие работает, когда прокси просит его.
 *   5. HTTPS-признак в X-Forwarded-Proto не ломает ответ.
 *   6. Запрос с Connection: close обрабатывается.
 *
 * Запуск: node src/tools/test-behind-proxy.js
 */

import { request as httpRequest } from 'node:http';

import { createStaticServer } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/** Запрос с произвольными заголовками. Возвращает raw-заголовки. */
function request(port, path, headers = {}) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers, agent: false, timeout: 8000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({
          status: res.statusCode,
          rawHeaders: res.rawHeaders,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', () => done({ status: 0, rawHeaders: [], headers: {}, body: Buffer.alloc(0) }));
    req.on('timeout', () => { req.destroy(); done({ status: 0, rawHeaders: [], headers: {}, body: Buffer.alloc(0) }); });
    req.end();
  });
}

/** Сколько раз заголовок встречается (по rawHeaders). */
function countHeader(rawHeaders, name) {
  const lower = name.toLowerCase();
  let n = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === lower) n += 1;
  }
  return n;
}

async function main() {
  console.log('='.repeat(70));
  console.log('СТАТИК-СЕРВЕР ЗА ОБРАТНЫМ ПРОКСИ');
  console.log('='.repeat(70));

  const server = createStaticServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // ─── 1. заголовки типичного прокси ───
    console.log('\n--- 1. заголовки прокси не ломают ответ ---');
    const proxyHeaders = {
      'x-forwarded-for': '203.0.113.42, 10.0.0.1',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'm62.example.com',
      'x-real-ip': '203.0.113.42',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ru-RU,ru;q=0.9',
    };
    const proxied = await request(port, '/', proxyHeaders);
    check('ответ 200 через прокси', proxied.status === 200, `HTTP ${proxied.status}`);
    check('тело непустое', proxied.body.length > 5000, `${proxied.body.length} байт`);

    // ─── 2. заголовки безопасности не дублируются ───
    console.log('\n--- 2. заголовки безопасности не дублируются ---');
    for (const name of ['content-security-policy', 'x-content-type-options',
      'referrer-policy', 'x-frame-options', 'permissions-policy']) {
      const n = countHeader(proxied.rawHeaders, name);
      check(`${name}: ровно один`, n === 1, `встречается ${n} раз`);
    }

    // ─── 3. content-length совпадает ───
    console.log('\n--- 3. content-length корректен ---');
    const declared = Number(proxied.headers['content-length']);
    check('content-length указан', Number.isFinite(declared) && declared > 0,
      String(declared));
    check('content-length совпадает с телом',
      declared === proxied.body.length,
      `заявлено ${declared}, получено ${proxied.body.length}`);

    // ─── 4. сжатие через прокси ───
    console.log('\n--- 4. сжатие по запросу прокси ---');
    const gz = await request(port, '/', {
      ...proxyHeaders,
      'accept-encoding': 'gzip, deflate, br',
    });
    check('сжатие применено', !!gz.headers['content-encoding'],
      String(gz.headers['content-encoding']));
    const gzDeclared = Number(gz.headers['content-length']);
    check('content-length соответствует сжатому телу',
      gzDeclared === gz.body.length,
      `заявлено ${gzDeclared}, получено ${gz.body.length}`);
    check('сжатый ответ меньше исходного', gz.body.length < proxied.body.length,
      `${proxied.body.length} -> ${gz.body.length}`);

    // ─── 5. HTTPS-признак ───
    console.log('\n--- 5. X-Forwarded-Proto: https ---');
    const httpsReq = await request(port, '/', { 'x-forwarded-proto': 'https' });
    check('не ломает ответ', httpsReq.status === 200, `HTTP ${httpsReq.status}`);
    // HSTS мы НЕ отдаём: сервер может работать по http локально,
    // а HSTS на http бессмыслен и запоминается браузером навсегда.
    check('сервер не отдаёт HSTS сам (это задача прокси)',
      !httpsReq.headers['strict-transport-security']);
    check('CSP остаётся строгим', String(httpsReq.headers['content-security-policy'])
      .includes("script-src 'self'"));

    // ─── 6. Connection: close ───
    console.log('\n--- 6. Connection: close ---');
    const closed = await request(port, '/', { connection: 'close' });
    check('ответ с Connection: close обработан', closed.status === 200,
      `HTTP ${closed.status}`);

    // ─── 7. Range-запрос (не поддерживаем, но не должны падать) ───
    console.log('\n--- 7. Range-запрос ---');
    const range = await request(port, '/', { range: 'bytes=0-100' });
    check('Range обработан без падения',
      range.status === 200 || range.status === 206 || range.status === 416,
      `HTTP ${range.status}`);

    // ─── 8. мусорные заголовки ───
    console.log('\n--- 8. необычные заголовки ---');
    const weird = await request(port, '/', {
      'x-custom-empty': '',
      'x-long-header': 'a'.repeat(4000),
      'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
    });
    check('необычные заголовки не ломают ответ', weird.status === 200,
      `HTTP ${weird.status}`);

    // ─── 9. HEAD через прокси ───
    console.log('\n--- 9. HEAD через прокси ---');
    const headRes = await new Promise((done) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/', method: 'HEAD', headers: proxyHeaders, agent: false },
        (res) => { res.resume(); done({ status: res.statusCode, headers: res.headers }); },
      );
      req.on('error', () => done({ status: 0, headers: {} }));
      req.end();
    });
    check('HEAD -> 200', headRes.status === 200, `HTTP ${headRes.status}`);
    check('HEAD сообщает content-length', Number(headRes.headers['content-length']) > 0);
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
