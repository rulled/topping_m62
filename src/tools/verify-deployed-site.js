/**
 * ПРОВЕРКА РАЗВЁРНУТОГО САЙТА (по URL, а не локально).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `check-deploy-readiness.js` проверяет, что проект ГОТОВ к публикации.
 * Но после публикации надо проверить другое: **что реально отдаёт
 * хостинг**.
 *
 * Типичные проблемы, которые видны только на живом домене:
 *   • хостинг переписал заголовки и потерял CSP;
 *   • сжатие не включено (или включено, но не для всех типов);
 *   • относительные пути сломались из-за редиректа;
 *   • один модуль не залился — и вся страница не работает;
 *   • HTTPS не настроен, из-за чего WebHID не даст доступ к карте.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Доступность: страница и все модули отдаются (200).
 *   2. HTTPS: WebHID работает только на защищённом соединении.
 *   3. Граф модулей: ни одного 404 — иначе страница не выполнится.
 *   4. Сжатие: включено и реально уменьшает ответ.
 *   5. Заголовки: CSP на месте (не потерялись на хостинге).
 *   6. Скорость: время ответа в разумных пределах.
 *
 * ═══ ЗАПУСК ═══
 *
 *     node src/tools/verify-deployed-site.js https://example.com/
 *     node src/tools/verify-deployed-site.js https://user.github.io/repo/
 *
 * Второй вариант проверяет хостинг в ПОДКАТАЛОГЕ — именно там
 * раньше ломались абсолютные пути.
 */

import http from 'node:http';
import https from 'node:https';

const url = process.argv[2];

if (!url) {
  console.error('использование: node src/tools/verify-deployed-site.js <URL>');
  console.error('пример: node src/tools/verify-deployed-site.js https://m62.example.com/');
  process.exit(1);
}

let base;
try {
  base = new URL(url);
} catch {
  console.error(`некорректный URL: ${url}`);
  process.exit(1);
}

let ok = 0;
let fail = 0;
let warn = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};
const note = (msg) => { warn += 1; console.log(`  !     ${msg}`); };

/**
 * Запрос с замерами.
 *
 * ═══ ПОЧЕМУ НЕ fetch ═══
 *
 * Глобальный `fetch` (undici) АВТОМАТИЧЕСКИ распаковывает ответ:
 * заголовок `content-encoding` остаётся, а тело приходит уже
 * распакованным. Из-за этого нельзя измерить выигрыш от сжатия —
 * первая версия этого скрипта показывала «21039 -> 21039 байт, 0%»,
 * то есть объявляла рабочий сервер сломанным.
 *
 * Поэтому используем голый `http`/`https`: он отдаёт тело как есть.
 */
function fetchInfo(target, extraHeaders = {}) {
  return new Promise((done) => {
    const u = new URL(target);
    const mod = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();

    const req = mod.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { 'user-agent': 'm62-deploy-check/1.0', ...extraHeaders },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          ms: Date.now() - t0,
          finalUrl: target,
        }));
      },
    );
    req.on('error', (err) => done({
      status: 0, headers: {}, body: Buffer.alloc(0), ms: Date.now() - t0, error: err.message,
    }));
    req.on('timeout', () => {
      req.destroy();
      done({ status: 0, headers: {}, body: Buffer.alloc(0), ms: Date.now() - t0, error: 'таймаут' });
    });
    req.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('ПРОВЕРКА РАЗВЁРНУТОГО САЙТА');
  console.log('='.repeat(70));
  console.log(`\nадрес: ${base.href}`);

  // ─── 1. HTTPS ───
  console.log('\n--- 1. защищённое соединение ---');
  const isHttps = base.protocol === 'https:';
  const isLocal = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  check('HTTPS (обязателен для WebHID)', isHttps || isLocal,
    isHttps ? 'https' : isLocal ? 'localhost — исключение' : base.protocol);
  if (!isHttps && !isLocal) {
    note('без HTTPS браузер не даст доступ к карте: navigator.hid не появится');
  }

  // ─── 2. страница ───
  console.log('\n--- 2. страница ---');
  const page = await fetchInfo(base.href);
  if (page.status === 0) {
    check('страница доступна', false, page.error);
    console.log('\nсайт недоступен — дальше проверять нечего');
    process.exitCode = 1;
    return;
  }
  check('страница отдаётся (200)', page.status === 200, `HTTP ${page.status}`);
  check('страница не пустая', page.body.length > 5000, `${page.body.length} байт`);
  check('это HTML',
    String(page.headers['content-type'] ?? '').includes('text/html'),
    String(page.headers['content-type']));
  check('время ответа < 2 с', page.ms < 2000, `${page.ms} мс`);

  if (page.finalUrl !== base.href) {
    note(`был редирект: ${base.href} -> ${page.finalUrl}`);
  }

  // ─── 3. заголовки безопасности ───
  console.log('\n--- 3. заголовки безопасности ---');
  const csp = page.headers['content-security-policy'];
  check('CSP сохранён хостингом', !!csp, csp ? csp.slice(0, 50) + '…' : 'нет');
  if (csp) {
    check('CSP запрещает внешние скрипты', csp.includes("script-src 'self'"));
    check('CSP не разрешает unsafe-inline',
      !csp.includes("script-src 'self' 'unsafe-inline'"));
  }
  check('есть nosniff', page.headers['x-content-type-options'] === 'nosniff');

  // ─── 4. сжатие ───
  console.log('\n--- 4. сжатие ---');
  const compressed = await fetchInfo(base.href, { 'accept-encoding': 'br, gzip' });
  const enc = compressed.headers['content-encoding'];
  check('сжатие включено на хостинге', !!enc, enc ?? 'нет сжатия');
  if (enc) {
    check('сжатый ответ меньше', compressed.body.length < page.body.length,
      `${page.body.length} -> ${compressed.body.length} байт`);
    const saved = Math.round((1 - compressed.body.length / page.body.length) * 100);
    check('экономия > 50%', saved > 50, `${saved}%`);
  } else {
    note('без сжатия страница грузится медленнее; проверьте настройки хостинга');
  }

  // ─── 5. граф модулей ───
  console.log('\n--- 5. модули страницы ---');
  const html = page.body.toString('utf8');

  // Скрипт подключён относительным путём — резолвим как браузер.
  const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
  check('страница подключает модульный скрипт', !!scriptMatch);

  if (!scriptMatch) {
    console.log('\nскрипт не найден — дальше проверять нечего');
    process.exitCode = 1;
    return;
  }

  const entryUrl = new URL(scriptMatch[1], page.finalUrl).href;
  const entry = await fetchInfo(entryUrl);
  check('входной скрипт отдаётся', entry.status === 200, `HTTP ${entry.status}`);
  check('это JavaScript',
    String(entry.headers['content-type'] ?? '').includes('javascript'),
    String(entry.headers['content-type']));

  if (entry.status !== 200) {
    note('страница не выполнится: один недоступный модуль рушит весь граф');
    process.exitCode = 1;
    return;
  }

  // Обход графа
  const seen = new Set();
  const queue = [];
  const collectImports = (text, fromUrl) => {
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      queue.push(new URL(spec, fromUrl).href);
    }
  };
  collectImports(entry.body.toString('utf8'), entryUrl);

  const broken = [];
  while (queue.length) {
    const target = queue.shift();
    if (seen.has(target)) continue;
    seen.add(target);

    const r = await fetchInfo(target);
    if (r.status !== 200) {
      broken.push(`${new URL(target).pathname} -> HTTP ${r.status}`);
      continue;
    }
    collectImports(r.body.toString('utf8'), target);
  }

  check(`все ${seen.size} модулей графа отдаются`, broken.length === 0,
    broken.join(', '));

  // ─── 6. серверный код не должен быть виден ───
  console.log('\n--- 6. утечки ---');
  const leaks = [];
  for (const path of ['/src/server.js', '/src/transport.js', '/package.json', '/.env']) {
    const r = await fetchInfo(new URL(path, page.finalUrl).href);
    if (r.status === 200) leaks.push(path);
  }
  check('серверный код не опубликован', leaks.length === 0, leaks.join(', '));
  if (leaks.length) {
    note('срочно: на сайте доступны внутренние файлы проекта');
  }

  // ─── итог ───
  console.log(`\n${'='.repeat(70)}`);
  console.log('ВЕРДИКТ');
  console.log('='.repeat(70));
  console.log(`\n  пройдено:  ${ok}`);
  console.log(`  провалено: ${fail}`);
  console.log(`  замечаний: ${warn}`);

  if (fail === 0) {
    console.log(`
  САЙТ РАЗВЁРНУТ КОРРЕКТНО.

  Осталось проверить руками (в браузере с картой):
    1. Откройте ${base.href} в Chrome или Edge.
    2. Нажмите «Подключить» — браузер спросит разрешение.
    3. Выберите M62 в списке.
    4. Статус должен стать «подключено», карточки заполниться.
`);
  } else {
    console.log('\n  ЕСТЬ ПРОБЛЕМЫ. Смотри провалы выше.\n');
  }

  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка проверки:', e?.message ?? e);
  process.exitCode = 1;
});
