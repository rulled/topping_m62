/**
 * ХЕЛПЕР ДЛЯ РАБОТЫ С ЖИВЫМ CHROME ЧЕРЕЗ CDP.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Нужно снять содержимое страницы так, как оно есть в браузере:
 * с выполненным JS, подгруженными шрифтами и стилями. Простой
 * `curl` этого не даст — там будет пустой каркас.
 *
 * ═══ КАК ПОЛЬЗОВАТЬСЯ ═══
 *
 *   node src/tools/cdp.js tabs
 *   node src/tools/cdp.js eval "<js-выражение>"
 *   node src/tools/cdp.js html > page.html
 *
 * Не аргумент командной строки, а файл со скриптом — чтобы длинные
 * выражения не ломались кавычками PowerShell.
 *
 *   node src/tools/cdp.js eval-file script.js
 */

import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const CDP = 'http://127.0.0.1:9222';

/**
 * Найти вкладку по подстроке URL.
 * @param {string} [match]
 * @returns {Promise<any>}
 */
async function findTab(match = '') {
  const res = await fetch(`${CDP}/json/list`);
  const tabs = await res.json();
  const pages = tabs.filter((t) => t.type === 'page');
  if (!match) return pages[0];
  return pages.find((t) => t.url.includes(match)) ?? pages[0];
}

/**
 * Открыть WebSocket к вкладке.
 * @param {string} wsUrl
 * @returns {Promise<WebSocket>}
 */
function connect(wsUrl) {
  return new Promise((done, reject) => {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    ws.once('open', () => done(ws));
    ws.once('error', reject);
  });
}

/**
 * Выполнить выражение в странице.
 * @param {WebSocket} ws
 * @param {string} expr
 * @returns {Promise<any>}
 */
async function evaluate(ws, expr) {
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
      reject(new Error('таймаут'));
    }, 60000);
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'tabs') {
    const res = await fetch(`${CDP}/json/list`);
    const tabs = await res.json();
    for (const t of tabs.filter((x) => x.type === 'page')) {
      console.log(`${t.title}\n  ${t.url}\n`);
    }
    return;
  }

  const tab = await findTab(rest[0]?.startsWith('--url=') ? rest[0].slice(6) : '');
  if (!tab) {
    console.error('нет открытых вкладок');
    process.exitCode = 1;
    return;
  }

  const ws = await connect(tab.webSocketDebuggerUrl);
  try {
    if (cmd === 'html') {
      const html = await evaluate(ws, 'document.documentElement.outerHTML');
      process.stdout.write(String(html));
      return;
    }

    if (cmd === 'eval') {
      const expr = rest.join(' ');
      const value = await evaluate(ws, expr);
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      return;
    }

    if (cmd === 'eval-file') {
      const expr = readFileSync(rest[0], 'utf8');
      const value = await evaluate(ws, expr);
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      return;
    }

    console.error('команды: tabs | html | eval <expr> | eval-file <path>');
    process.exitCode = 2;
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
