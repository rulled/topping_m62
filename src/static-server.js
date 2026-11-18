/**
 * ПРОДАКШН-СЕРВЕР: только статика.
 *
 * ═══ ЗАЧЕМ ОТДЕЛЬНЫЙ СЕРВЕР ═══
 *
 * `src/server.js` — это 2383 строки и 61 маршрут: агент, workspace,
 * UIA-управление MCC, аудио-параметры Windows. Для хостинга сайта всё
 * это не нужно и вредно:
 *
 *   • увеличивает поверхность атаки (лишние маршруты);
 *   • тянет node-hid, ws и Windows-зависимости;
 *   • сервер не должен управлять картой — это делает браузер.
 *
 * Здесь — ровно то, что нужно: отдать `index.html` и 15 ES-модулей,
 * с которыми он работает. Ничего больше.
 *
 * ═══ ЧТО ОТДАЁТСЯ ═══
 *
 * Только файлы из ЯВНОГО списка. Не «всё из web/ и src/», а
 * перечисленные поимённо. Причина: `src/` содержит десятки модулей
 * для Node (workspace, UIA, state-store). Отдавать их нельзя — они
 * утекут внутренней логикой и всё равно не запустятся в браузере.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Обход каталога невозможен: имя запроса нормализуется и сверяется
 * с белым списком. Никаких `..`, никаких абсолютных путей.
 *
 * ═══ ЗАПУСК ═══
 *
 *     node src/static-server.js
 *     PORT=8080 node src/static-server.js
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Белый список файлов: URL -> путь на диске.
 *
 * Перечислены поимённо, а не сгенерированы обходом каталога.
 * Новый модуль, который нужен странице, надо добавить сюда руками —
 * это защита от случайной утечки серверного кода.
 */
export const ALLOWED_FILES = new Map([
  // страница
  ['/', 'web/index.html'],
  ['/index.html', 'web/index.html'],

  // клиентские модули страницы (браузерный граф)
  ['/web/mixer-state.js', 'web/mixer-state.js'],
  ['/web/scenes.js', 'web/scenes.js'],
  ['/web/app.js', 'web/app.js'],

  ['/src/transport-core.js', 'src/transport-core.js'],
  ['/src/transport-consts.js', 'src/transport-consts.js'],
  ['/src/adapter-webhid.js', 'src/adapter-webhid.js'],
  ['/src/protocol.js', 'src/protocol.js'],
  ['/src/crc16.js', 'src/crc16.js'],

  // доменные модули: адреса, шкалы, кадры
  ['/src/eq-hid.js', 'src/eq-hid.js'],
  ['/src/eq-hp.js', 'src/eq-hp.js'],
  ['/src/comp-hid.js', 'src/comp-hid.js'],
  ['/src/reverb-hid.js', 'src/reverb-hid.js'],
  ['/src/phantom-hid.js', 'src/phantom-hid.js'],
  ['/src/mixer-tags.js', 'src/mixer-tags.js'],
  ['/src/mutes-loopback.js', 'src/mutes-loopback.js'],
  ['/src/gain-scales.js', 'src/gain-scales.js'],
]);

/** MIME-типы. Только то, что реально отдаём. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/**
 * Заголовки безопасности.
 *
 * ═══ ПОЧЕМУ ИМЕННО ЭТИ ═══
 *
 * Content-Security-Policy — главное. Разрешаем только скрипты со
 * своего origin (сайт не грузит ничего внешнего), запрещаем инлайны
 * кроме стилей (страница использует <style> в самом файле).
 *
 * WebHID не требует особых разрешений в CSP: это API браузера, а не
 * сетевой запрос. Разрешение `hid` в Permissions-Policy нужно, чтобы
 * встраивание в iframe не ломалось молча.
 *
 * ═══ ЧЕГО ЗДЕСЬ НЕТ ═══
 *
 * Нет CORS: страница и модули с одного origin, чужим сайтам данные не
 * нужны. Нет HSTS: сервер может работать на localhost по http.
 */
const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'hid=(self), usb=()',
  'x-frame-options': 'DENY',
};

/**
 * Кэширование.
 *
 * HTML не кэшируем (страница обновляется), модули — на 1 час.
 * Для продакшена с хешами в именах файлов можно поставить
 * `immutable`, но у нас имена фиксированные, поэтому умеренный TTL.
 */
function cacheControl(ext) {
  return ext === '.html' ? 'no-cache' : 'public, max-age=3600';
}

/**
 * Обработчик запроса.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleRequest(req, res) {
  // Разрешаем только GET и HEAD: статика не принимает данные.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }

  // Разбираем путь без query и hash.
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }

  // Нормализуем: убираем повторные слеши, запрещаем `..`.
  if (pathname.includes('..') || pathname.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad path');
    return;
  }

  const diskPath = ALLOWED_FILES.get(pathname);
  if (!diskPath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  let body;
  try {
    body = await readFile(diskPath);
  } catch {
    // Файл в белом списке, но отсутствует на диске — это ошибка
    // развёртывания, а не клиента.
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('file missing on server');
    return;
  }

  const ext = extname(diskPath).toLowerCase();
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': cacheControl(ext),
    ...SECURITY_HEADERS,
  };

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

/**
 * Создать сервер.
 *
 * Вынесено отдельно от запуска, чтобы тесты могли поднять сервер на
 * случайном порту, не трогая процесс.
 *
 * @returns {import('node:http').Server}
 */
export function createStaticServer() {
  return createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      // Не роняем процесс из-за одного запроса.
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end('internal error');
      // В лог — только суть, без стека в ответ клиенту.
      console.error('[static] ошибка запроса:', err?.message ?? err);
    });
  });
}

/**
 * Точка входа при прямом запуске.
 *
 * ═══ ПОЧЕМУ ТАКАЯ ПРОВЕРКА ═══
 *
 * Первая версия сравнивала `import.meta.url` с `file://${argv[1]}`.
 * На Windows это ломалось: путь содержит пробелы и обратные слеши,
 * и сравнение не совпадало. Хуже — модуль, импортированный тестом,
 * тоже запускал сервер на 8080, из-за чего тест висел.
 *
 * Правильный способ: сравнить нормализованные пути через fileURLToPath
 * и path.resolve.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const entry = fileURLToPath(import.meta.url);
    const invoked = resolve(process.argv[1]);
    return entry === invoked;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = Number(process.env.PORT) || 8080;
  const server = createStaticServer();
  server.listen(port, () => {
    console.log(`[static] сайт: http://127.0.0.1:${port}/`);
    console.log(`[static] файлов в белом списке: ${ALLOWED_FILES.size}`);
    console.log('[static] управление картой идёт из браузера через WebHID');
  });
}
