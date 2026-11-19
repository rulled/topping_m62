/**
 * ЧЕК-ЛИСТ ГОТОВНОСТИ К ПУБЛИКАЦИИ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Цель проекта: «захостить сайт, чтобы любой человек зашёл и смог
 * управлять своей M62». Перед публикацией надо ответить на один
 * вопрос: **готово или нет**.
 *
 * Разрозненные тесты этого не говорят: они проверяют частности.
 * Этот скрипт собирает ВСЕ требования в одном месте и даёт один
 * вердикт — можно публиковать или нет.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   A. Технически: сервер отдаёт все нужные файлы, сжимает,
 *      не отдаёт лишнего.
 *   Б. Безопасно: CSP, отсутствие инлайн-скриптов, нет утечек.
 *   В. Развёртываемо: Dockerfile согласован, healthcheck есть, CI есть.
 *   Г. Честно: на странице есть предупреждения о том, что карта
 *      не отдаёт.
 *
 * ═══ ЧЕГО ЭТОТ СКРИПТ НЕ ПРОВЕРЯЕТ ═══
 *
 * Работу с реальной картой (WebHID в headless недоступен) и
 * обработку отказов браузера — это делает человек в видимом окне.
 *
 * Запуск: node src/tools/check-deploy-readiness.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

let ok = 0;
let fail = 0;
let warn = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};
const note = (msg) => { warn += 1; console.log(`  !     ${msg}`); };

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
  console.log('='.repeat(70));
  console.log('ГОТОВНОСТЬ К ПУБЛИКАЦИИ');
  console.log('='.repeat(70));

  // ═══ A. ФАЙЛЫ НА МЕСТЕ ═══
  console.log('\n--- A. что публикуем ---');

  const required = [
    'src/static-server.js',
    'web/index.html',
    'web/app.js',
    'web/mixer-state.js',
    'web/scenes.js',
    'Dockerfile',
    'package.json',
    '.github/workflows/ci.yml',
    'docs/DEPLOY.md',
  ];
  for (const f of required) {
    check(`есть ${f}`, existsSync(f));
  }

  // ═══ Б. СЕРВЕР РАБОТАЕТ ═══
  console.log('\n--- Б. сервер ---');
  const port = 8097;
  const child = spawn(process.execPath, ['src/static-server.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(200);
      if ((await get(port, '/health')).status === 200) { ready = true; break; }
    }
    check('сервер поднимается', ready);
    if (!ready) {
      console.log(`вывод: ${out}`);
      process.exitCode = 1;
      return;
    }

    const health = await get(port, '/health');
    let hj = null;
    try { hj = JSON.parse(health.body.toString()); } catch { /* ниже */ }
    check('/health отвечает', hj?.ok === true, JSON.stringify(hj));

    const page = await get(port, '/');
    check('страница отдаётся', page.status === 200, `HTTP ${page.status}`);
    check('страница не пустая', page.body.length > 10000, `${page.body.length} байт`);

    // Все модули графа
    const app = await get(port, '/web/app.js');
    check('клиентский скрипт отдаётся', app.status === 200, `HTTP ${app.status}`);
    const imports = [...app.body.toString().matchAll(/from\s+'(\/[^']+)'/g)]
      .map((m) => m[1]);
    const broken = [];
    for (const spec of imports) {
      if ((await get(port, spec)).status !== 200) broken.push(spec);
    }
    check(`все ${imports.length} модулей графа отдаются`, broken.length === 0,
      broken.join(', '));

    // ═══ В. БЕЗОПАСНОСТЬ ═══
    console.log('\n--- В. безопасность ---');
    const csp = String(page.headers['content-security-policy'] ?? '');
    check('CSP задан', !!csp);
    check('CSP запрещает внешние скрипты', csp.includes("script-src 'self'"));
    check('CSP не разрешает unsafe-inline для скриптов',
      !csp.includes("script-src 'self' 'unsafe-inline'"));

    const html = page.body.toString();
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .filter((m) => m[1].trim().length > 0);
    check('нет инлайн-скриптов (CSP их убьёт)', inline.length === 0,
      `найдено ${inline.length}`);

    const leaks = [];
    for (const p of ['/src/server.js', '/src/transport.js', '/package.json',
      '/.env', '/.git/config']) {
      if ((await get(port, p)).status === 200) leaks.push(p);
    }
    check('серверный код не отдаётся', leaks.length === 0, leaks.join(', '));

    check('есть nosniff', page.headers['x-content-type-options'] === 'nosniff');

    // ═══ Г. СКОРОСТЬ ═══
    console.log('\n--- Г. скорость ---');
    const br = await get(port, '/', { 'accept-encoding': 'br, gzip' });
    check('сжатие работает', !!br.headers['content-encoding'],
      String(br.headers['content-encoding']));
    const saved = 1 - br.body.length / page.body.length;
    check('страница сжата более чем вдвое', saved > 0.5,
      `${Math.round(saved * 100)}% экономии`);
    check('сжатая страница < 15 КБ', br.body.length < 15000,
      `${br.body.length} байт`);

    // ═══ Д. ЧЕСТНОСТЬ НА СТРАНИЦЕ ═══
    console.log('\n--- Д. честность интерфейса ---');
    check('есть предупреждение про микшер',
      /не отдаёт микшер|Состояние — наше/.test(html));
    check('есть предупреждение про loopback',
      /Гейн и источник loopback карта\s*не отдаёт|loopback карта/.test(html));
    check('есть объяснение про WebHID',
      /WebHID|Chrome или Edge/.test(html));

    // ═══ Е. ОГРАНИЧЕНИЯ ═══
    console.log('\n--- Е. известные ограничения ---');
    // Сайт использует относительные пути — работает и в корне,
    // и в подкаталоге (GitHub Pages).
    const relImports = [...app.body.toString().matchAll(/from\s+'(\.[^']+)'/g)];
    const absImports = [...app.body.toString().matchAll(/from\s+'(\/(?:src|web)\/[^']+)'/g)];
    check('пути относительные — работает и в подкаталоге',
      absImports.length === 0 && relImports.length > 0,
      `относительных ${relImports.length}, абсолютных ${absImports.length}`);
    note('WebHID нет на Android/iOS и в Firefox/Safari — '
      + 'это ограничение браузеров, не наше');
    note('обработка отказов браузера — задача фазы фронта');
  } finally {
    try { child.kill('SIGKILL'); } catch { /* уже */ }
    await sleep(150);
  }

  // ═══ Ж. CI И DOCKER ═══
  console.log('\n--- Ж. развёртывание ---');
  const ci = existsSync('.github/workflows/ci.yml')
    ? readFileSync('.github/workflows/ci.yml', 'utf8') : '';
  check('CI настроен', !!ci);
  check('CI проверяет линтер', /npm run lint/.test(ci));
  check('CI собирает Docker', /docker build/.test(ci));
  check('CI проверяет healthcheck', /\/health/.test(ci));
  check('CI гоняет тесты на Windows', /windows-latest/.test(ci));

  const docker = existsSync('Dockerfile') ? readFileSync('Dockerfile', 'utf8') : '';
  check('Dockerfile запускает не от root', /^USER\s+(?!root)/m.test(docker));
  check('Dockerfile имеет HEALTHCHECK', /^HEALTHCHECK/m.test(docker));
  check('Dockerfile CMD в exec-форме', /^CMD\s+\[/m.test(docker));

  // ═══ ИТОГ ═══
  console.log(`\n${'='.repeat(70)}`);
  console.log('ВЕРДИКТ');
  console.log('='.repeat(70));
  console.log(`\n  пройдено:  ${ok}`);
  console.log(`  провалено: ${fail}`);
  console.log(`  замечаний: ${warn}`);

  if (fail === 0) {
    console.log(`
  БЭКЕНД ГОТОВ К ПУБЛИКАЦИИ.

  Технически: сервер отдаёт всё нужное, сжимает, не отдаёт лишнего.
  Безопасно: CSP строгий, инлайн-скриптов нет, утечек нет.
  Развёртываемо: Docker и CI настроены.

  ЧТО НЕЛЬЗЯ ПРОВЕРИТЬ АВТОМАТИЧЕСКИ (нужен человек):
    • работу с реальной картой — WebHID требует видимого окна
      и выбора устройства в диалоге;
    • обработку отказов браузера — это фаза фронта.

  ЧТО НУЖНО СДЕЛАТЬ ПЕРЕД ПУБЛИКАЦИЕЙ:
    • домен и HTTPS-сертификат (без HTTPS WebHID не работает);
    • выложить содержимое белого списка — пути относительные,
      поэтому сайт работает и в корне домена, и в подкаталоге
      (проверяется выше, test-subdirectory-hosting.js).
`);
  } else {
    console.log('\n  НЕ ГОТОВО. Смотри провалы выше.\n');
  }

  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
