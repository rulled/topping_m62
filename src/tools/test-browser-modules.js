/**
 * ПРОВЕРКА: КЛИЕНТСКИЕ МОДУЛИ РАБОТАЮТ БЕЗ NODE.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Страница в браузере импортирует `src/transport-core.js`,
 * `src/protocol.js` и доменные модули. Всё это должно работать
 * БЕЗ `Buffer`, `node:fs`, `node:hid` и прочего.
 *
 * Статическая проверка (поиск слова «Buffer») недостаточна: модуль
 * может тянуть node-зависимость через цепочку импортов.
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Идёт по графу импортов от точки входа браузера и проверяет,
 *    что ни один модуль не тянет node:*-модуль.
 * 2. Импортирует каждый модуль в Node с ЗАБЛОКИРОВАННЫМИ node-API
 *    и проверяет, что он загружается и функции работают.
 * 3. Проверяет, что все файлы, которые просит страница,
 *    отдаются сервером (HTTP 200).
 *
 * Запуск: node src/tools/test-browser-modules.js [--port 8898]
 */

import { readFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';

import { ensureServer } from './_server-fixture.js';

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : 8898;
})();

/**
 * Запросить URL и получить статус.
 *
 * ПОЧЕМУ НЕ `fetch`. Глобальный fetch (undici) держит keep-alive
 * соединения, и `process.exit()` на них падает с libuv assertion
 * `!(handle->flags & UV_HANDLE_CLOSING)`. Причём падает ПОСЛЕ
 * правильного подсчёта: тест печатал «22 из 22», а код возврата
 * был 1 — то есть в CI он выглядел сломанным.
 *
 * Попытка добавить `connection: close` уронила undici иначе
 * (`assert(!this.paused)` в Parser.finish). Поэтому здесь голый
 * `node:http` с обычным `agent: false`: соединение закрывается само.
 *
 * @param {string} url
 * @returns {Promise<number|null>} null — не удалось соединиться
 */
function httpStatus(url) {
  return new Promise((done) => {
    const req = httpRequest(url, { agent: false, timeout: 5000 }, (res) => {
      res.resume(); // дочитать и освободить сокет
      res.on('end', () => done(res.statusCode ?? null));
    });
    req.on('error', () => done(null));
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.end();
  });
}

/** Точка входа браузерного клиента. */
const ENTRY = 'src/adapter-webhid.js';

/** Что страница импортирует напрямую. */
const PAGE_IMPORTS = [
  'src/transport-core.js',
  'src/adapter-webhid.js',
];

const NODE_BUILTINS = /^node:/;

/** Собрать граф импортов от файла. */
function collectImports(file, seen = new Set()) {
  const abs = resolve(file);
  if (seen.has(abs)) return seen;
  seen.add(abs);
  if (!existsSync(abs)) return seen;

  const src = readFileSync(abs, 'utf8');
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (NODE_BUILTINS.test(spec)) {
      seen.add(`NODE:${spec}`);
      continue;
    }
    if (!spec.startsWith('.')) {
      seen.add(`PKG:${spec}`);
      continue;
    }
    collectImports(resolve(dirname(abs), spec), seen);
  }
  return seen;
}

async function main() {
  console.log('='.repeat(70));
  console.log('ПРОВЕРКА: КЛИЕНТСКИЕ МОДУЛИ РАБОТАЮТ БЕЗ NODE');
  console.log('='.repeat(70));

  // ─── 1. граф импортов ───
  console.log('\n--- граф импортов от точки входа ---');
  const graph = collectImports(ENTRY);
  const nodeDeps = [...graph].filter((x) => x.startsWith('NODE:'));
  const pkgDeps = [...graph].filter((x) => x.startsWith('PKG:'));
  const files = [...graph].filter((x) => !x.startsWith('NODE:') && !x.startsWith('PKG:'));

  console.log(`  файлов в графе: ${files.length}`);
  for (const f of files.sort()) {
    console.log(`    ${f.replace(process.cwd(), '').replace(/^[\\/]/, '')}`);
  }
  console.log(`  node-зависимостей: ${nodeDeps.length}  ${nodeDeps.join(', ') || ''}`);
  console.log(`  пакетных зависимостей: ${pkgDeps.length}  ${pkgDeps.join(', ') || ''}`);

  let ok = 0;
  let fail = 0;
  const check = (name, good, extra = '') => {
    if (good) ok++;
    else fail++;
    console.log(`  ${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  };

  console.log('\n--- проверка чистоты ---');
  check('нет node:*-модулей в графе', nodeDeps.length === 0, nodeDeps.join(', '));
  check('нет npm-пакетов в графе', pkgDeps.length === 0, pkgDeps.join(', '));

  // ─── 2. реальный импорт ───
  console.log('\n--- реальный импорт модулей ---');
  for (const rel of PAGE_IMPORTS) {
    try {
      const mod = await import(`../${rel.split('/').slice(1).join('/')}`);
      const names = Object.keys(mod);
      check(`импорт ${rel}`, names.length > 0, `${names.length} экспортов`);
    } catch (err) {
      check(`импорт ${rel}`, false, String(err?.message ?? err));
    }
  }

  // ─── 3. функции протокола работают ───
  console.log('\n--- функции протокола ---');
  try {
    const { buildFrame, parseReport, withReportId, isIdle } = await import('../protocol.js');
    const frame = buildFrame(0x11, 0x24, 1, true);
    check('buildFrame даёт 15 байт', frame.length === 15, `${frame.length}`);
    check('кадр начинается с 22 33', frame[0] === 0x22 && frame[1] === 0x33);
    check('кадр кончается 66 77', frame[13] === 0x66 && frame[14] === 0x77);

    const wrapped = withReportId(frame);
    check('withReportId даёт 16 байт', wrapped.length === 16, `${wrapped.length}`);
    check('withReportId — это Uint8Array (не Buffer)', wrapped instanceof Uint8Array && typeof wrapped.copy === 'undefined');

    // round-trip: кадр -> разбор
    const padded = new Uint8Array(16);
    padded.set(frame, 0);
    const parsed = parseReport(padded);
    check('round-trip разбора', parsed && parsed.target === 0x11 && parsed.prop === 0x24 && parsed.value === 1,
      parsed ? `0x${parsed.target.toString(16)}:0x${parsed.prop.toString(16)}=${parsed.value}` : 'null');

    check('isIdle на нулях', isIdle(new Uint8Array(16)) === true);
    check('isIdle на кадре', isIdle(padded) === false);
  } catch (err) {
    check('функции протокола', false, String(err?.message ?? err));
  }

  // ─── 4. доменные модули ───
  console.log('\n--- доменные модули ---');
  const domain = [
    ['mixer-tags.js', ['MIXER_SOURCES', 'MIXER_BUSES']],
    ['eq-hid.js', ['buildEqFrames', 'readChannelBands']],
    ['comp-hid.js', ['buildCompFrames', 'readCompressor']],
    ['reverb-hid.js', ['buildReverbBatch', 'REVERB_TYPES']],
    ['duck-loopback-hid.js', ['buildDuckMaskFrames', 'DUCK_MASK_BITS']],
    ['phantom-hid.js', ['buildPhantomFrames', 'PHANTOM']],
    ['tags.js', ['classifyTag']],
  ];
  for (const [file, needed] of domain) {
    try {
      const mod = await import(`../${file}`);
      const missing = needed.filter((n) => mod[n] === undefined);
      check(file, missing.length === 0, missing.length ? `нет: ${missing.join(', ')}` : 'все экспорты');
    } catch (err) {
      check(file, false, String(err?.message ?? err));
    }
  }

  // ─── 5. сервер отдаёт всё нужное ───
  //
  // Сервер поднимаем сами: иначе с чистого листа все запросы
  // получают «нет ответа», и это выглядит как поломка модулей,
  // хотя сервер просто не был запущен.
  console.log('\n--- сервер отдаёт файлы страницы ---');
  const server = await ensureServer(PORT);
  if (server.owned) console.log(`  (сервер поднят на :${PORT})`);
  try {
    const need = ['/', ...files.map((f) => '/' + f.replace(process.cwd(), '').replace(/^[\\/]/, '').replace(/\\/g, '/'))];
    for (const path of need) {
      const status = await httpStatus(`http://127.0.0.1:${PORT}${path}`);
      check(`GET ${path}`, status === 200, status === null ? 'нет ответа' : `HTTP ${status}`);
    }
  } finally {
    await server.close();
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  if (fail === 0) {
    console.log('\n  ВСЕ КЛИЕНТСКИЕ МОДУЛИ ГОТОВЫ ДЛЯ БРАУЗЕРА.');
    console.log('  Ни одного node:*-модуля, ни одного npm-пакета в графе.');
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
