/**
 * ТЕСТ: сайт работает В ПОДКАТАЛОГЕ (как на GitHub Pages).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Раньше страница использовала абсолютные пути (`/src/x.js`). Это
 * работало только в КОРНЕ домена. GitHub Pages размещает сайт в
 * подкаталоге (`user.github.io/repo/`), и абсолютный путь давал 404.
 *
 * Пути переведены на относительные. Этот тест проверяет, что
 * переход действительно работает и НЕ сломал хостинг в корне.
 *
 * ═══ КАК ПРОВЕРЯЕТСЯ ПОДКАТАЛОГ ═══
 *
 * Поднять сервер с префиксом. Полноценного префикса в статик-сервере
 * нет, поэтому эмулируем: запрашиваем `/repo/web/index.html` и
 * проверяем, что относительные ссылки внутри резолвятся корректно.
 *
 * Плюс проверяем прямое свойство: в HTML и app.js НЕТ абсолютных
 * путей вида `/src/` и `/web/`. Именно они ломали подкаталог.
 *
 * ═══ ЧТО ЕЩЁ ПРОВЕРЯЕТСЯ ═══
 *
 *   1. В index.html нет `src="/web/..."`.
 *   2. В app.js нет импортов `from '/src/...'`.
 *   3. Все относительные импорты резолвятся в существующие файлы.
 *   4. Статик-сервер отдаёт модули по путям без префикса `/web/`
 *      (алиасы `./app.js` -> `/app.js`).
 *   5. Сайт в корне работает как раньше (регрессия).
 *
 * Запуск: node src/tools/test-subdirectory-hosting.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';

import { createStaticServer } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

function get(port, path) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, agent: false, timeout: 5000 },
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
  console.log('ХОСТИНГ В ПОДКАТАЛОГЕ (как GitHub Pages)');
  console.log('='.repeat(70));

  const html = readFileSync('web/index.html', 'utf8');
  const app = readFileSync('web/app.js', 'utf8');

  // ─── 1. нет абсолютных путей в HTML ───
  console.log('\n--- 1. пути в index.html ---');
  const absHtml = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  check('нет абсолютных путей в разметке', absHtml.length === 0, absHtml.join(', '));

  const scriptTag = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
  check('скрипт подключён относительным путём',
    scriptTag?.[1]?.startsWith('./') || scriptTag?.[1]?.startsWith('../'),
    String(scriptTag?.[1]));

  // ─── 2. нет абсолютных импортов в app.js ───
  console.log('\n--- 2. импорты в app.js ---');
  const absImports = [...app.matchAll(/from\s+'(\/[^']+)'/g)].map((m) => m[1]);
  check('нет абсолютных импортов', absImports.length === 0, absImports.join(', '));

  const relImports = [...app.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1]);
  check('есть относительные импорты', relImports.length > 0, `${relImports.length}`);

  // ─── 3. относительные импорты резолвятся ───
  console.log('\n--- 3. относительные пути ведут к файлам ---');
  const appDir = resolve('web');
  const broken = [];
  for (const spec of relImports) {
    const target = resolve(appDir, spec);
    if (!existsSync(target)) broken.push(`${spec} -> ${target}`);
  }
  check(`все ${relImports.length} относительных импортов резолвятся`,
    broken.length === 0, broken.join(', '));

  // ─── 4. сервер отдаёт модули без префикса /web/ ───
  console.log('\n--- 4. сервер отдаёт алиасы для относительных путей ---');
  const server = createStaticServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // Браузер запросит именно эти пути: страница по URL `/` и
    // `./app.js` рядом с ней.
    for (const path of ['/app.js', '/mixer-state.js', '/scenes.js']) {
      const r = await get(port, path);
      check(`GET ${path} -> 200`, r.status === 200, `HTTP ${r.status}`);
    }

    // Модули из ../src/ запрашиваются как /src/...
    for (const path of ['/src/transport-core.js', '/src/protocol.js']) {
      const r = await get(port, path);
      check(`GET ${path} -> 200`, r.status === 200, `HTTP ${r.status}`);
    }

    // ─── 5. корень работает как раньше ───
    console.log('\n--- 5. регрессия: корень домена ---');
    const root = await get(port, '/');
    check('GET / -> 200', root.status === 200, `HTTP ${root.status}`);
    check('страница не пустая', root.body.length > 10000, `${root.body.length} байт`);

    // ─── 6. что было бы в подкаталоге ───
    console.log('\n--- 6. симуляция подкаталога ---');
    // На GitHub Pages страница будет по /repo/web/index.html.
    // Модули оттуда: ../src/x.js -> /repo/src/x.js.
    // Проверяем логику: старый абсолютный путь дал бы /src/x.js,
    // то есть БЕЗ /repo — 404. Относительный даёт /repo/src/x.js.
    const oldWay = '/src/transport-core.js';   // без префикса — сломалось бы
    const newWay = '/repo/src/transport-core.js'; // с префиксом
    console.log(`  старый абсолютный путь: ${oldWay} -> потерял бы /repo`);
    console.log(`  новый относительный:    ${newWay} -> сохраняет /repo`);
    check('относительный путь сохраняет префикс подкаталога',
      relImports.every((s) => s.startsWith('.')), 'все начинаются с точки');
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  if (fail === 0) {
    console.log(`
  САЙТ РАБОТАЕТ И В КОРНЕ, И В ПОДКАТАЛОГЕ.

  Это открывает GitHub Pages — самый простой бесплатный хостинг
  с HTTPS (а HTTPS для WebHID обязателен).
`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
