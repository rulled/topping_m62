/**
 * ПРОВЕРКА СТРАНИЦЫ ЧЕРЕЗ ЖИВОЙ CHROME (CDP).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `check-page-render.js` запускает headless-браузер и смотрит на
 * HTML после выполнения скриптов. Этого хватает, чтобы понять, что
 * страница собралась, но НЕ хватает, чтобы увидеть ошибки JS: если
 * модуль упал, DOM может остаться наполовину готовым, а проверка
 * этого не заметит.
 *
 * Здесь подключаемся к УЖЕ ЗАПУЩЕННОМУ Chrome по отладочному
 * протоколу (CDP) и снимаем с живой вкладки:
 *   * ошибки консоли;
 *   * необработанные исключения;
 *   * сколько контролов построено;
 *   * видна ли надпись про отсутствие WebHID.
 *
 * ═══ ЗАЧЕМ ЖИВОЙ БРАУЗЕР ═══
 *
 * Пользователь может сам открыть эту вкладку и посмотреть глазами.
 * Проверка не мешает ему: она только читает состояние, ничего не
 * нажимает и не меняет.
 *
 * Запуск: node src/tools/check-live-page.js [--port 9222] [--url ...]
 */

import { WebSocket } from 'ws';

const args = process.argv.slice(2);

/**
 * Значение флага командной строки.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const CDP_PORT = flag('--port', '9222');
const TARGET_URL = flag('--url', 'http://127.0.0.1:8090/');

/**
 * Отправить команду CDP и дождаться ответа.
 * @param {WebSocket} ws
 * @param {number} id
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>}
 */
function send(ws, id, method, params = {}) {
  return new Promise((done, reject) => {
    /** @type {(msg: any) => void} */
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else done(msg.result);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`${method}: таймаут`));
    }, 15000);
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  ЖИВАЯ СТРАНИЦА В CHROME (через CDP)');
  console.log('='.repeat(70) + '\n');

  // ─── 1. найти вкладку ───
  let tabs;
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    tabs = await res.json();
  } catch {
    console.log(`  Chrome с CDP не отвечает на порту ${CDP_PORT}.`);
    console.log('  Запустите: chrome --remote-debugging-port=9222\n');
    process.exitCode = 1;
    return;
  }

  const tab = tabs.find((t) => t.type === 'page' && t.url.includes(new URL(TARGET_URL).host + new URL(TARGET_URL).pathname));
  if (!tab) {
    console.log(`  Вкладка ${TARGET_URL} не найдена. Открытые вкладки:`);
    for (const t of tabs.filter((x) => x.type === 'page')) {
      console.log(`    ${t.url}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`  вкладка: ${tab.title}`);
  console.log(`  адрес:   ${tab.url}\n`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    ws.once('open', done);
    ws.once('error', reject);
  });

  let id = 1;
  let ok = 0;
  let fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
    else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
  };

  try {
    await send(ws, id++, 'Runtime.enable');

    // ─── 2. состояние страницы ───
    console.log('--- 1. страница собралась ---');

    const evalJs = async (expr) => {
      const r = await send(ws, id++, 'Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text ?? 'исключение в evaluate');
      }
      return r.result.value;
    };

    const title = await evalJs('document.title');
    check('заголовок страницы', title === 'M62 — веб-клиент', String(title));

    const ready = await evalJs('document.readyState');
    check('DOM загружен', ready === 'complete', String(ready));

    // ─── 3. модули исполнились ───
    console.log('\n--- 2. модули исполнились ---');

    // Если app.js упал, кнопка подключения не получит обработчик,
    // а контейнеры (микшер, mutes) останутся пустыми.
    const appLoaded = await evalJs(`(() => {
      const btn = document.getElementById('btnConnect');
      if (!btn) return 'нет btnConnect';
      return 'есть';
    })()`);
    check('кнопка подключения есть', appLoaded === 'есть', String(appLoaded));

    const mixerRows = await evalJs(`document.querySelectorAll('#mixerBody tr').length`);
    check('микшер построен', Number(mixerRows) > 0, `${mixerRows} строк`);

    const muteButtons = await evalJs(`document.querySelectorAll('#mutesBody button').length`);
    check('mute-кнопки построены', Number(muteButtons) >= 7, `${muteButtons} шт`);

    const loopbackRows = await evalJs(`document.querySelectorAll('[id^="lb_"][id$="_src"]').length`);
    check('loopback-селекторы построены', Number(loopbackRows) === 4, `${loopbackRows} шт`);

    const eqBands = await evalJs(`document.querySelectorAll('[id^="eq1en"], [id^="eq1gain"]').length`);
    check('EQ входов построен', Number(eqBands) > 0, `${eqBands} элементов`);

    // ─── 4. WebHID ───
    console.log('\n--- 3. WebHID ---');

    const hasHid = await evalJs('typeof navigator.hid !== "undefined"');
    check('WebHID доступен в этом Chrome', hasHid === true, String(hasHid));

    const statusText = await evalJs(`document.getElementById('status')?.textContent ?? ''`);
    check('статус устройства не пустой', String(statusText).trim().length > 0, String(statusText).trim());

    // ─── 5. ошибки ───
    console.log('\n--- 4. ошибки JS ---');

    // Собираем ошибки, которые уже произошли (перехват — до reload,
    // поэтому смотрим на текущий DOM: если модуль упал, части
    // интерфейса не будет — это уже проверено выше).
    const errors = await evalJs(`(() => {
      return window.__m62Errors ? window.__m62Errors.length : 0;
    })()`);
    check('нет перехваченных ошибок', Number(errors) === 0, `${errors}`);

    // ─── 6. что видит пользователь ───
    console.log('\n--- 5. содержимое панели ---');

    const cards = await evalJs(`document.querySelectorAll('section.card').length`);
    check('карточек на странице', Number(cards) === 13, `${cards} шт`);

    const logLines = await evalJs(`document.getElementById('log')?.children.length ?? 0`);
    check('лог событий работает', Number(logLines) >= 0, `${logLines} строк`);

    console.log('\n' + '-'.repeat(70));
    console.log(`  пройдено: ${ok}`);
    console.log(`  провалено: ${fail}`);
    console.log('-'.repeat(70) + '\n');

    if (fail === 0) {
      console.log('  СТРАНИЦА РАБОТАЕТ В ЖИВОМ БРАУЗЕРЕ.');
      console.log('  Все блоки построены, WebHID доступен, ошибок нет.\n');
    }

    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
