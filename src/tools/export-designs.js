/**
 * ВЫГРУЗКА ДИЗАЙНОВ С variant.com В САМОСТОЯТЕЛЬНЫЕ HTML.
 *
 * ═══ ЧТО НУЖНО ═══
 *
 * Пользователь сохранил на variant.com три дизайна-референса и хочет
 * отдать их дизайнеру как обычные HTML-файлы: открыл двойным щелчком —
 * всё видно, все иконки на месте, ничего не отваливается.
 *
 * ═══ КАК ЭТО УСТРОЕНО НА САЙТЕ ═══
 *
 * Каждый дизайн показывается в <iframe> без src, но с тем же
 * источником (same-origin). Внутрь можно заглянуть через
 * `iframe.contentDocument`, и там уже лежит готовый HTML:
 *
 *   * стили — в теге <style> (уже внутри);
 *   * иконки — инлайновые <svg> (внешних картинок нет вообще);
 *   * скрипты — инлайновые, небольшие;
 *   * шрифт Inter — единственное, что подгружается снаружи
 *     (fonts.googleapis.com).
 *
 * ═══ ПОЧЕМУ ГРУЗИМ ШРИФТ, А НЕ ОСТАВЛЯЕМ ССЫЛКУ ═══
 *
 * Если оставить <link> на Google Fonts, файл будет зависеть от
 * интернета и от того, доступен ли Google. Дизайнер откроет файл
 * офлайн — и увидит подмену шрифта, то есть не то, что задумано.
 *
 * Поэтому CSS шрифта скачивается, а woff2-файлы встраиваются в CSS
 * как base64. Один файл, без зависимостей.
 *
 * Запуск: node src/tools/export-designs.js
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocket } from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = resolve(ROOT, 'research', 'design-references');
const CDP = 'http://127.0.0.1:9222';

/** Имена файлов по внутреннему заголовку дизайна. */
const NAMES = {
  'Orb': '01-orb-capture-app.html',
  '3D Camera Control Component': '02-3d-camera-buttons.html',
  'Active Recording Session': '03-explore-more.html',
};

/**
 * Подключиться к вкладке браузера.
 * @returns {Promise<WebSocket>}
 */
async function connectTab() {
  const res = await fetch(`${CDP}/json/list`);
  const tabs = await res.json();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('variant.com'));
  if (!page) throw new Error('вкладка variant.com не найдена');

  return new Promise((done, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    ws.once('open', () => done(ws));
    ws.once('error', reject);
  });
}

/**
 * Выполнить выражение на странице.
 * @param {WebSocket} ws
 * @param {string} expr
 * @returns {Promise<any>}
 */
function evaluate(ws, expr) {
  return new Promise((done, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text ?? 'исключение'));
      } else done(msg.result?.result?.value);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
    setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('таймаут CDP'));
    }, 120000);
  });
}

/**
 * Скачать Google Fonts CSS и встроить woff2 как base64.
 *
 * ═══ ПОЧЕМУ НЕ ВСЁ ПОДРЯД ═══
 *
 * Google отдаёт 35 @font-face блоков — по одному на каждый языковой
 * набор (латиница, кириллица, греческий, вьетнамский, армянский…).
 * Встроить их все значит раздуть файл до 1.5 МБ.
 *
 * Для макетов нужны только латиница и кириллица — остальные наборы
 * в дизайне не встречаются. Их и оставляем: файл становится в
 * несколько раз легче, а вид не меняется.
 *
 * ═══ ПОЧЕМУ ВАЖЕН user-agent ═══
 *
 * Без современного UA Google отдаёт TTF вместо WOFF2 — втрое больше
 * вес при том же шрифте.
 *
 * @param {string} cssUrl
 * @returns {Promise<string>} CSS с data:URI вместо url(...)
 */
async function inlineFontCss(cssUrl) {
  const res = await fetch(cssUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  let css = await res.text();

  // Разбираем на блоки @font-face и оставляем только нужные языки.
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const kept = [];

  for (const block of blocks) {
    const range = /unicode-range:\s*([^;]+)/.exec(block)?.[1] ?? '';

    // Кириллица: U+0400-04FF и окрестности. Латиница: U+0000-00FF.
    const isLatin = /U\+0000-00FF|U\+0000-00ff/.test(range) || range === '';
    const isCyrillic = /U\+0400-045F|U\+0400-04FF/.test(range);

    if (isLatin || isCyrillic) {
      // Встроим сам файл шрифта.
      const url = /url\((https:\/\/[^)]+)\)/.exec(block)?.[1];
      if (url) {
        try {
          const r = await fetch(url);
          const buf = Buffer.from(await r.arrayBuffer());
          kept.push(block.split(url).join(`data:font/woff2;base64,${buf.toString('base64')}`));
        } catch {
          kept.push(block);
        }
      } else {
        kept.push(block);
      }
    }
  }

  if (kept.length === 0) {
    // Ничего не распознали — встраиваем как есть, лучше тяжелее, чем без шрифта.
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        css = css.split(url).join(`data:font/woff2;base64,${buf.toString('base64')}`);
      } catch {
        /* оставляем как есть */
      }
    }
    return css;
  }

  return kept.join('\n');
}

/**
 * Собрать самостоятельный HTML из документа внутри iframe.
 * @param {WebSocket} ws
 * @param {number} frameIndex
 * @returns {Promise<{html: string, title: string}>}
 */
async function extractDesign(ws, frameIndex) {
  // Забираем всё сразу: заголовок, стили шрифтов и HTML.
  const data = await evaluate(ws, `(() => {
    const frames = [...document.querySelectorAll('iframe')];
    const f = frames[${frameIndex}];
    if (!f) return null;
    const doc = f.contentDocument;
    if (!doc) return null;

    const fontLinks = [...doc.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => l.href)
      .filter((h) => h.includes('fonts.googleapis'));

    return {
      title: doc.title || '',
      fontLinks,
      html: doc.documentElement.outerHTML,
    };
  })()`);

  if (!data) throw new Error(`iframe ${frameIndex}: нет доступа`);

  // Встраиваем шрифты прямо в HTML вместо внешних <link>.
  let html = data.html;
  for (const link of data.fontLinks) {
    const fontCss = await inlineFontCss(link);

    // В HTML адрес записан с &amp; (так требует разметка), а в JS мы
    // получили раскодированный вариант. Ищем оба.
    const variants = [link, link.replace(/&/g, '&amp;')];

    let replaced = false;
    for (const v of variants) {
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`<link[^>]*href="${escaped}"[^>]*>`, 'i');
      if (re.test(html)) {
        html = html.replace(re, `<style data-inlined-from="font">\n${fontCss}\n</style>`);
        replaced = true;
        break;
      }
    }

    // Страховка: если точное совпадение не нашлось, вырезаем любой
    // <link>, ведущий на fonts.googleapis, и кладём стиль отдельно.
    if (!replaced) {
      html = html.replace(
        /<link[^>]*fonts\.googleapis\.com[^>]*>/gi,
        `<style data-inlined-from="font">\n${fontCss}\n</style>`,
      );
    }
  }

  // Убираем preconnect: он бесполезен без внешних запросов.
  html = html.replace(/<link[^>]*rel="preconnect"[^>]*>/gi, '');

  // ─── шрифты, подключённые через @import ───
  //
  // В одних дизайнах шрифт грузится тегом <link>, в других — строкой
  // `@import url('https://fonts.googleapis.com/...')` внутри CSS.
  // Второй вариант легко пропустить: в разметке внешней ссылки нет,
  // а браузер всё равно идёт в интернет.
  const imports = [...html.matchAll(/@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^)'"]+)['"]?\)\s*;?/g)];
  for (const m of imports) {
    const fontCss = await inlineFontCss(m[1].replace(/&amp;/g, '&'));
    html = html.split(m[0]).join(`/* шрифт встроен */\n${fontCss}`);
  }

  return { html, title: data.title };
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  ВЫГРУЗКА ДИЗАЙН-РЕФЕРЕНСОВ');
  console.log('='.repeat(70) + '\n');

  mkdirSync(OUT_DIR, { recursive: true });

  const ws = await connectTab();
  try {
    // Сколько всего iframe на странице — берём уникальные по заголовку.
    const titles = await evaluate(ws, `(() => {
      return [...document.querySelectorAll('iframe')].map((f, i) => {
        try { return { i, title: f.contentDocument?.title || '' }; }
        catch { return { i, title: '' }; }
      });
    })()`);

    // Оставляем по одному iframe на каждый уникальный дизайн.
    /** @type {Map<string, number>} */
    const byTitle = new Map();
    for (const t of titles) {
      if (!t.title) continue;
      if (!byTitle.has(t.title)) byTitle.set(t.title, t.i);
    }

    console.log(`  найдено дизайнов: ${byTitle.size}\n`);

    const problems = [];
    for (const [title, index] of byTitle) {
      const fileName = NAMES[title] ?? `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;

      process.stdout.write(`  ${title} ... `);
      try {
        const { html } = await extractDesign(ws, index);

        // Проверяем, что внешних зависимостей не осталось.
        const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
          .map((m) => m[1])
          .filter((u) => !u.startsWith('data:'));

        const full = `<!doctype html>\n${html}`;
        writeFileSync(resolve(OUT_DIR, fileName), full, 'utf8');

        const kb = Math.round(Buffer.byteLength(full) / 1024);
        console.log(`${kb} КБ -> ${fileName}`);
        if (external.length) {
          console.log(`    ! внешние ссылки: ${external.slice(0, 3).join(', ')}`);
          problems.push(`${fileName}: ${external.length} внешних ссылок`);
        }
      } catch (e) {
        console.log(`ОШИБКА: ${e?.message ?? e}`);
        problems.push(`${title}: ${e?.message ?? e}`);
      }
    }

    // Сохраним и общий вид страницы борда — как референс компоновки.
    try {
      const board = await evaluate(ws, `document.documentElement.outerHTML`);
      writeFileSync(resolve(OUT_DIR, '_board-full-page.html'), board, 'utf8');
      console.log(`\n  вся страница борда -> _board-full-page.html`);
    } catch {
      /* не критично */
    }

    console.log('\n' + '-'.repeat(70));
    if (problems.length === 0) {
      console.log('  ГОТОВО: каждый дизайн — отдельный файл без внешних зависимостей.');
      console.log(`  Папка: ${OUT_DIR}\n`);
    } else {
      console.log('  ЕСТЬ ЗАМЕЧАНИЯ:');
      for (const p of problems) console.log(`    ${p}`);
      console.log('');
    }
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
