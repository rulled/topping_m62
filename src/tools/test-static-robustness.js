/**
 * ТЕСТ: устойчивость статик-сервера к плохим запросам.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Сайт публичный. Значит в него будут биться:
 *   • сканеры уязвимостей — тысячами мусорных URL;
 *   • боты, которые не читают ответ и держат соединение;
 *   • клиенты с обрезанными заголовками;
 *   • запросы с гигантскими URL.
 *
 * Сервер не должен от этого падать или замедляться.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Мусорные URL -> 400/404, процесс жив.
 *   2. Гигантский URL не роняет сервер.
 *   3. Бинарный мусор в URL.
 *   4. Сто конкурентных запросов обслуживаются.
 *   5. Медленный клиент не блокирует остальных (slowloris).
 *   6. После всех атак сервер по-прежнему отдаёт страницу.
 *
 * ═══ ПОЧЕМУ ПОСЛЕДНЯЯ ПРОВЕРКА ГЛАВНАЯ ═══
 *
 * Отдельный «ответ 400» ничего не значит. Значит только то, что
 * после серии атак сервер работает нормально — то есть не потёк по
 * памяти, не накопил висящих сокетов и не сломал внутреннее
 * состояние.
 *
 * Запуск: node src/tools/test-static-robustness.js
 */

import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { createStaticServer } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

function request(port, path, opts = {}) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', agent: false, timeout: 8000, ...opts },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', () => done({ status: 0, body: Buffer.alloc(0) }));
    req.on('timeout', () => { req.destroy(); done({ status: 0, body: Buffer.alloc(0) }); });
    req.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('СТАТИК-СЕРВЕР: УСТОЙЧИВОСТЬ');
  console.log('='.repeat(70));

  const server = createStaticServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // ─── 1. мусорные URL ───
    console.log('\n--- 1. мусорные URL ---');
    const junk = [
      '/../../etc/passwd',
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/etc/passwd',
      '/C:/Windows/System32/config/SAM',
      '/.env',
      '/.git/config',
      '/wp-admin',
      '/phpmyadmin',
      '/admin.php',
      '/../../../../../../etc/shadow',
      '/src/../src/server.js',
      '/%00',
      '/src/%00.js',
      '/anything?x=1&y=2',
      '//etc/passwd',
      // ВНИМАНИЕ: '/././././' здесь НЕТ намеренно.
      // WHATWG URL нормализует его в '/', и сервер честно отдаёт
      // главную страницу. Это правильное поведение: точка в пути
      // означает «текущий каталог», а не попытку выхода.
      // Проверять её как атаку — ошибка теста, а не сервера.
    ];
    const badStatuses = [];
    for (const path of junk) {
      const r = await request(port, path);
      // Ожидаем 400 или 404. 200 на любом из них — утечка.
      if (r.status !== 400 && r.status !== 404) {
        badStatuses.push(`${path} -> ${r.status}`);
      }
    }
    check(`${junk.length} мусорных URL отклонены`, badStatuses.length === 0,
      badStatuses.join(', '));

    // ─── 2. гигантский URL ───
    console.log('\n--- 2. гигантский URL ---');
    const huge = '/' + 'a'.repeat(60000);
    const hugeRes = await request(port, huge);
    check('URL на 60 000 символов не роняет сервер',
      // 431 = Request Header Fields Too Large: встроенная защита Node.
      // Это правильное поведение, а не пропуск запроса.
      [400, 404, 414, 431].includes(hugeRes.status),
      `HTTP ${hugeRes.status}`);

    // ─── 3. бинарный мусор ───
    console.log('\n--- 3. бинарный мусор в URL ---');
    const binary = await request(port, '/src/%ff%fe%fd.js');
    check('невалидный UTF-8 в URL обработан',
      binary.status === 400 || binary.status === 404, `HTTP ${binary.status}`);

    // ─── 4. конкурентность ───
    console.log('\n--- 4. конкурентные запросы ---');
    const CONCURRENT = 100;
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) => request(port, i % 2 === 0 ? '/' : '/src/protocol.js')),
    );
    const elapsed = Date.now() - t0;
    const okCount = results.filter((r) => r.status === 200).length;
    check(`${CONCURRENT} одновременных запросов обслужены`,
      okCount === CONCURRENT, `${okCount}/${CONCURRENT} за ${elapsed} мс`);
    check('это заняло разумное время (<5 с)', elapsed < 5000, `${elapsed} мс`);

    // ─── 5. медленный клиент (slowloris) ───
    //
    // Открываем соединение и отправляем только часть заголовков.
    // Сервер не должен ждать такого клиента вечно — иначе несколько
    // десятков таких соединений займут все слоты.
    console.log('\n--- 5. медленные клиенты (slowloris) ---');
    const slow = [];
    for (let i = 0; i < 5; i += 1) {
      const socket = connect(port, '127.0.0.1');
      socket.on('error', () => { /* соединение может закрыться */ });
      socket.write('GET / HTTP/1.1\r\nHost: x\r\n');
      // Дальше не пишем — держим соединение открытым.
      slow.push(socket);
    }
    await sleep(300);

    // Пока они висят, сервер обязан отвечать нормально.
    const duringT0 = Date.now();
    const during = await request(port, '/');
    const duringMs = Date.now() - duringT0;
    check('медленные клиенты не блокируют остальных',
      during.status === 200 && duringMs < 2000,
      `HTTP ${during.status} за ${duringMs} мс`);

    // Закрываем висящие соединения.
    for (const s of slow) {
      try { s.destroy(); } catch { /* уже */ }
    }
    await sleep(200);

    // ─── 6. главное: сервер жив после всего ───
    console.log('\n--- 6. сервер жив после атак ---');
    const after = await request(port, '/');
    check('страница отдаётся после серии атак', after.status === 200,
      `HTTP ${after.status}`);
    check('тело страницы непустое', after.body.length > 5000,
      `${after.body.length} байт`);

    const health = await request(port, '/health');
    check('/health отвечает', health.status === 200, `HTTP ${health.status}`);

    // ─── 7. мусорные методы ───
    console.log('\n--- 7. необычные методы ---');
    for (const method of ['DELETE', 'PUT', 'PATCH', 'OPTIONS', 'TRACE']) {
      const r = await request(port, '/', { method });
      // TRACE/OPTIONS могут вернуть 405 — это правильно.
      check(`${method} отклонён`, r.status === 405 || r.status === 501,
        `HTTP ${r.status}`);
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


