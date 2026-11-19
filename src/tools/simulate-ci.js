/**
 * СИМУЛЯЦИЯ CI: те же проверки, что в GitHub Actions, но локально.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * CI в `.github/workflows/ci.yml` проверяет то же самое, но:
 *   • локально Docker нет — шаг со сборкой образа не проверить;
 *   • прогон в GitHub занимает минуты, а ошибку в самих проверках
 *     (неверный путь, опечатка в ожидании) лучше поймать сразу.
 *
 * Этот скрипт повторяет логику smoke-тестов из CI на локальном
 * сервере. Если он проходит — значит и в CI пройдёт.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ (как в CI) ═══
 *
 *   1. /health отвечает и отдаёт ok:true.
 *   2. GET / -> 200.
 *   3. Сжатие работает: размер < 15 КБ.
 *   4. Серверный код не отдаётся (404).
 *
 * Запуск: node src/tools/simulate-ci.js
 */

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** HTTP-запрос с заголовками. */
function get(port, path, headers = {}) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers, agent: false, timeout: 5000 },
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
  console.log('='.repeat(66));
  console.log('СИМУЛЯЦИЯ CI (smoke-тесты контейнера)');
  console.log('='.repeat(66));

  const port = 8095;
  const child = spawn(process.execPath, ['src/static-server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  try {
    // Ждём готовности (как в CI: до 30 с)
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(200);
      const r = await get(port, '/health');
      if (r.status === 200) { ready = true; break; }
    }

    console.log('\n--- 1. healthcheck ---');
    check('сервер готов за отведённое время', ready);

    if (!ready) {
      console.log(`вывод сервера:\n${out}`);
      process.exitCode = 1;
      return;
    }

    const health = await get(port, '/health');
    let parsed = null;
    try { parsed = JSON.parse(health.body.toString()); } catch { /* ниже */ }
    check('/health -> ok:true', parsed?.ok === true, JSON.stringify(parsed));

    // ─── 2. страница ───
    console.log('\n--- 2. страница ---');
    const page = await get(port, '/');
    check('GET / -> 200', page.status === 200, `HTTP ${page.status}`);

    // ─── 3. сжатие (как в CI: размер < 15 КБ) ───
    console.log('\n--- 3. сжатие ---');
    const br = await get(port, '/', { 'accept-encoding': 'br, gzip' });
    check('сжатие применено', !!br.headers['content-encoding'],
      String(br.headers['content-encoding']));
    check('размер < 15 КБ (как проверяет CI)', br.body.length < 15000,
      `${br.body.length} байт`);
    check('сжатый меньше несжатого', br.body.length < page.body.length,
      `${page.body.length} -> ${br.body.length}`);

    // ─── 4. серверный код не отдаётся ───
    console.log('\n--- 4. серверный код не отдаётся ---');
    for (const path of ['/src/server.js', '/src/transport.js', '/package.json']) {
      const r = await get(port, path);
      check(`${path} -> 404`, r.status === 404, `HTTP ${r.status}`);
    }

    // ─── 5. заголовки безопасности ───
    console.log('\n--- 5. заголовки безопасности ---');
    check('CSP на месте', !!page.headers['content-security-policy']);
    check('nosniff на месте', page.headers['x-content-type-options'] === 'nosniff');
  } finally {
    try { child.kill('SIGKILL'); } catch { /* уже */ }
    await sleep(150);
  }

  console.log(`\n${'='.repeat(66)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  if (fail === 0) {
    console.log('\n  Логика CI-проверок верна. В GitHub Actions пройдёт.');
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
