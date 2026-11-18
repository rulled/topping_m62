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
 * Здесь — ровно то, что нужно: отдать `index.html`, клиентский скрипт
 * и 15 ES-модулей, с которыми он работает.
 *
 * ═══ ЧТО ОТДАЁТСЯ ═══
 *
 * Только файлы из ЯВНОГО списка. Не «всё из web/ и src/», а
 * перечисленные поимённо. Причина: `src/` содержит десятки модулей
 * для Node (workspace, UIA, state-store). Отдавать их нельзя — они
 * утекут внутренней логикой и всё равно не запустятся в браузере.
 *
 * ═══ ЧТО ДЕЛАЕТ СЕРВЕР ДЛЯ СКОРОСТИ ═══
 *
 *   1. Сжатие gzip/brotli — 185 КБ превращаются в ~50 КБ.
 *   2. ETag — повторный визит не скачивает файлы заново (304).
 *   3. Кэш в памяти — файлы читаются с диска один раз.
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
 *     HOST=0.0.0.0 PORT=80 node src/static-server.js
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

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
  ['/web/app.js', 'web/app.js'],
  ['/web/mixer-state.js', 'web/mixer-state.js'],
  ['/web/scenes.js', 'web/scenes.js'],

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

/**
 * Служебные пути, которые НЕ отдаются как файлы, а обрабатываются.
 *
 * `/health` нужен хостингу: платформы (Docker, Kubernetes, Cloudflare)
 * опрашивают его, чтобы понять, что сервис жив. Без него контейнер
 * может считаться мёртвым, хотя сервер работает.
 */
const SPECIAL = {
  health: '/health',
};

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
 * ВАЖНО: `script-src 'self'` без `'unsafe-inline'`. Однажды это уже
 * сломало страницу — в HTML был встроенный скрипт на 40 КБ, и CSP его
 * заблокировал. Скрипт вынесен в web/app.js. Ослаблять CSP нельзя:
 * это откроет XSS и скроет причину.
 *
 * WebHID не требует особых разрешений в CSP: это API браузера, а не
 * сетевой запрос. Разрешение `hid` в Permissions-Policy нужно, чтобы
 * встраивание в iframe не ломалось молча.
 *
 * ═══ ЧЕГО ЗДЕСЬ НЕТ ═══
 *
 * Нет CORS: страница и модули с одного origin, чужим сайтам данные не
 * нужны. Нет HSTS: сервер может работать на localhost по http, а HSTS
 * на http бессмыслен и запоминается браузером навсегда.
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
 * Кэш в памяти: URL -> { body, etag, gzip, br, type, ext }.
 *
 * ЗАЧЕМ: файлы не меняются во время работы сервера, а читать их с
 * диска на каждый запрос — лишние системные вызовы. Особенно заметно
 * при первом заходе, когда браузер запрашивает 18 файлов сразу.
 *
 * Сжатые версии тоже кэшируются: сжимать 185 КБ на каждый запрос
 * расточительно.
 */
const cache = new Map();

/**
 * Кэширование в браузере.
 *
 * HTML не кэшируем (страница обновляется), модули — на 1 час.
 * Для продакшена с хешами в именах файлов можно поставить
 * `immutable`, но у нас имена фиксированные, поэтому умеренный TTL.
 *
 * Дополнительно всегда отдаём ETag: даже в пределах часа браузер
 * сделает условный запрос и получит 304 вместо тела.
 */
function cacheControl(ext) {
  return ext === '.html' ? 'no-cache' : 'public, max-age=3600';
}

/**
 * Загрузить файл и подготовить сжатые версии.
 *
 * @param {string} url
 * @param {string} diskPath
 * @returns {Promise<object>}
 */
async function loadFile(url, diskPath) {
  const cached = cache.get(url);
  if (cached) return cached;

  const body = await readFile(diskPath);
  const ext = extname(diskPath).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';

  // ETag по содержимому: если файл изменят и перезапустят сервер,
  // браузер получит новую версию, а не 304 на старое.
  const etag = `"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;

  // Сжимаем только текстовые файлы и только если это даёт выигрыш.
  // Небольшие файлы сжимать бессмысленно: заголовки съедят экономию.
  const compressible = /^(text\/|application\/(json|javascript))/.test(type);
  const worthCompressing = compressible && body.length > 1024;

  const entry = { body, etag, type, ext, gzip: null, br: null };
  if (worthCompressing) {
    try {
      const [gz, br] = await Promise.all([
        gzipAsync(body, { level: 9 }),
        brotli(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
      ]);
      // Берём сжатие только если оно реально меньше.
      if (gz.length < body.length) entry.gzip = gz;
      if (br.length < body.length) entry.br = br;
    } catch {
      // Сжатие не критично: если не получилось, отдадим как есть.
    }
  }

  cache.set(url, entry);
  return entry;
}

/** Выбрать сжатие по Accept-Encoding. */
function pickEncoding(req, entry) {
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (entry.br && /\bbr\b/.test(accept)) return 'br';
  if (entry.gzip && /\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

/** Ответ с телом. */
function sendBody(req, res, status, body, headers) {
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

/** Простой текстовый ответ (ошибки, health). */
function sendText(req, res, status, text, extra = {}) {
  const body = Buffer.from(text, 'utf8');
  sendBody(req, res, status, body, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    ...SECURITY_HEADERS,
    ...extra,
  });
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
    sendText(req, res, 405, 'method not allowed', { allow: 'GET, HEAD' });
    return;
  }

  // Разбираем путь без query и hash.
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    sendText(req, res, 400, 'bad request');
    return;
  }

  // ─── healthcheck ───
  //
  // Нужен хостингу: Docker/K8s/Cloudflare опрашивают его, чтобы
  // понять, что сервис жив. Отвечаем без обращения к диску.
  if (pathname === SPECIAL.health) {
    sendText(req, res, 200, JSON.stringify({
      ok: true,
      files: ALLOWED_FILES.size,
      cached: cache.size,
      uptime: Math.round(process.uptime()),
    }), { 'content-type': 'application/json; charset=utf-8' });
    return;
  }

  // Нормализуем: запрещаем `..` и нулевые байты.
  if (pathname.includes('..') || pathname.includes('\0')) {
    sendText(req, res, 400, 'bad path');
    return;
  }

  const diskPath = ALLOWED_FILES.get(pathname);
  if (!diskPath) {
    sendText(req, res, 404, 'not found');
    return;
  }

  let entry;
  try {
    entry = await loadFile(pathname, diskPath);
  } catch {
    // Файл в белом списке, но отсутствует на диске — это ошибка
    // развёртывания, а не клиента.
    console.error(`[static] файл отсутствует: ${diskPath}`);
    sendText(req, res, 500, 'file missing on server');
    return;
  }

  // ─── условный запрос ───
  //
  // Браузер запоминает ETag и при повторном визите присылает его.
  // Если файл не изменился — отдаём 304 без тела. Это экономит
  // трафик при каждом обновлении страницы.
  const inm = req.headers['if-none-match'];
  if (inm && inm === entry.etag) {
    res.writeHead(304, {
      etag: entry.etag,
      'cache-control': cacheControl(entry.ext),
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  // ─── сжатие ───
  const encoding = pickEncoding(req, entry);
  const body = encoding === 'br' ? entry.br : encoding === 'gzip' ? entry.gzip : entry.body;

  const headers = {
    'content-type': entry.type,
    'content-length': body.length,
    'cache-control': cacheControl(entry.ext),
    etag: entry.etag,
    // Vary обязателен: иначе прокси может отдать gzip браузеру,
    // который его не понимает.
    vary: 'accept-encoding',
    ...SECURITY_HEADERS,
  };
  if (encoding) headers['content-encoding'] = encoding;

  sendBody(req, res, 200, body, headers);
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
      const message = err?.message ?? String(err);
      console.error('[static] ошибка запроса:', message);
      if (!res.headersSent) {
        sendText(req, res, 500, 'internal error');
      } else {
        res.end();
      }
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

function start() {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const server = createStaticServer();

  server.listen(port, host, () => {
    console.log(`[static] слушаю ${host}:${port}`);
    console.log(`[static] файлов в белом списке: ${ALLOWED_FILES.size}`);
    console.log('[static] управление картой идёт из браузера через WebHID');
  });

  /**
   * Graceful shutdown.
   *
   * ЗАЧЕМ: при перезапуске (деплой, рестарт контейнера) сервер должен
   * доотдать текущие ответы, а не оборвать их. Платформы дают на это
   * несколько секунд, потом убивают процесс.
   *
   * Если не закрыться за отведённое время — выходим принудительно,
   * иначе платформа убьёт нас с ошибкой в логах.
   */
  const shutdown = (signal) => {
    console.log(`[static] ${signal}: закрываюсь…`);
    server.close(() => {
      console.log('[static] закрыт');
      process.exit(0);
    });
    // Страховка: если через 5 с не закрылись — выходим.
    setTimeout(() => {
      console.error('[static] не закрылся за 5 с, выхожу принудительно');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (isMainModule()) {
  start();
}

/** Для тестов: сбросить кэш между прогонами. */
export function clearCache() {
  cache.clear();
}

