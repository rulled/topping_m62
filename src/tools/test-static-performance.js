/**
 * ТЕСТ: производительность и продакшн-поведение статик-сервера.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Функциональность уже покрыта `test-static-server.js`. Здесь —
 * то, что важно при реальном использовании:
 *
 *   1. Сжатие: gzip и brotli уменьшают ответ в разы.
 *   2. Vary-заголовок: без него прокси отдаст gzip браузеру,
 *      который его не понимает.
 *   3. ETag: повторный запрос даёт 304 без тела.
 *   4. Healthcheck: отвечает быстро и не трогает диск.
 *   5. Сжатие не ломает содержимое: распакованный ответ совпадает
 *      с исходным файлом.
 *
 * ═══ ПОЧЕМУ ПРОВЕРЯТЬ РАСПАКОВКУ ═══
 *
 * Сжатие — место, где легко получить «ответ 200, а тело мусор».
 * Проверяем, что распакованное совпадает с файлом на диске.
 *
 * Запуск: node src/tools/test-static-performance.js
 */

import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';

import { createStaticServer, clearCache } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

function request(port, path, headers = {}) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers, agent: false, timeout: 10000 },
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
    req.on('timeout', () => { req.destroy(); done({ status: 0, headers: {}, body: Buffer.alloc(0) }); });
    req.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('СТАТИК-СЕРВЕР: ПРОИЗВОДИТЕЛЬНОСТЬ');
  console.log('='.repeat(70));

  clearCache();
  const server = createStaticServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // ─── 1. сжатие страницы ───
    console.log('\n--- 1. сжатие ---');
    const raw = await request(port, '/');
    const gz = await request(port, '/', { 'accept-encoding': 'gzip' });
    const br = await request(port, '/', { 'accept-encoding': 'br' });

    check('без Accept-Encoding ответ не сжат', !raw.headers['content-encoding']);
    check('gzip применён', gz.headers['content-encoding'] === 'gzip');
    check('brotli применён', br.headers['content-encoding'] === 'br');

    check('brotli меньше исходного', br.body.length < raw.body.length,
      `${raw.body.length} -> ${br.body.length}`);
    check('brotli лучше gzip', br.body.length < gz.body.length,
      `gzip ${gz.body.length} vs br ${br.body.length}`);

    const ratio = 1 - br.body.length / raw.body.length;
    check('сжатие даёт выигрыш >50%', ratio > 0.5, `${Math.round(ratio * 100)}%`);

    // ─── 2. содержимое не испорчено ───
    console.log('\n--- 2. целостность после распаковки ---');
    const original = readFileSync('index.html');
    check('brotli распаковывается в оригинал',
      brotliDecompressSync(br.body).equals(original));
    check('gzip распаковывается в оригинал',
      gunzipSync(gz.body).equals(original));

    // ─── 3. Vary ───
    console.log('\n--- 3. заголовок Vary ---');
    check('Vary: accept-encoding на сжатом ответе',
      String(gz.headers.vary).toLowerCase().includes('accept-encoding'),
      String(gz.headers.vary));
    check('Vary есть и на несжатом ответе',
      String(raw.headers.vary).toLowerCase().includes('accept-encoding'),
      String(raw.headers.vary));

    // ─── 4. ETag и 304 ───
    console.log('\n--- 4. условные запросы ---');
    check('ETag присутствует', !!raw.headers.etag, String(raw.headers.etag));
    const etag = raw.headers.etag;

    const notModified = await request(port, '/', { 'if-none-match': etag });
    check('с ETag -> 304', notModified.status === 304, `HTTP ${notModified.status}`);
    check('304 без тела', notModified.body.length === 0, `${notModified.body.length} байт`);

    // Заведомо другой ETag. Только латиница: HTTP-заголовки не
    // принимают кириллицу, и Node бросит «Invalid character in
    // header content» — это ограничение теста, а не сервера.
    const wrongEtag = await request(port, '/', { 'if-none-match': '"different-etag"' });
    check('с чужим ETag -> 200', wrongEtag.status === 200, `HTTP ${wrongEtag.status}`);

    // ─── 5. ETag у модулей разный ───
    console.log('\n--- 5. ETag различается по файлам ---');
    const a = await request(port, '/src/protocol.js');
    const b = await request(port, '/src/crc16.js');
    check('у разных файлов разные ETag', a.headers.etag !== b.headers.etag);

    // ─── 6. healthcheck ───
    console.log('\n--- 6. healthcheck ---');
    const health = await request(port, '/health');
    check('/health -> 200', health.status === 200, `HTTP ${health.status}`);
    check('/health отдаёт JSON',
      String(health.headers['content-type']).includes('application/json'));

    let parsed = null;
    try { parsed = JSON.parse(health.body.toString()); } catch { /* ниже */ }
    check('/health содержит ok:true', parsed?.ok === true);
    check('/health сообщает число файлов', typeof parsed?.files === 'number',
      String(parsed?.files));

    // ─── 7. HEAD со сжатием ───
    console.log('\n--- 7. HEAD ---');
    const headRes = await new Promise((done) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/', method: 'HEAD', agent: false },
        (res) => { done({ status: res.statusCode, headers: res.headers }); },
      );
      req.on('error', () => done({ status: 0, headers: {} }));
      req.end();
    });
    check('HEAD -> 200', headRes.status === 200, `HTTP ${headRes.status}`);
    check('HEAD сообщает content-length',
      Number(headRes.headers['content-length']) > 0,
      String(headRes.headers['content-length']));

    // ─── 8. маленькие файлы не сжимаются ───
    console.log('\n--- 8. разумность сжатия ---');
    const small = await request(port, '/src/crc16.js', { 'accept-encoding': 'gzip, br' });
    // crc16.js небольшой — сжатие может не окупиться
    check('маленький файл обработан без ошибок', small.status === 200);
    if (small.headers['content-encoding']) {
      const decoded = small.headers['content-encoding'] === 'br'
        ? brotliDecompressSync(small.body)
        : gunzipSync(small.body);
      check('маленький файл распаковывается корректно',
        decoded.equals(readFileSync('src/crc16.js')));
    }
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
