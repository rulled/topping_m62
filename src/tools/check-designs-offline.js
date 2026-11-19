/**
 * ПРОВЕРКА: ФАЙЛЫ РАБОТАЮТ БЕЗ ИНТЕРНЕТА.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Дизайнер может открыть файл офлайн. Если внутри осталась хоть одна
 * внешняя ссылка (шрифт, картинка, стиль), вид изменится: шрифт
 * подменится, иконка не загрузится.
 *
 * Проверка жёсткая: в CDP включается блокировка сети, после чего
 * файл открывается заново. Если внешние ссылки были — они упадут, и
 * это будет видно по ошибкам загрузки.
 *
 * Запуск: node src/tools/check-designs-offline.js
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WebSocket } from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = resolve(ROOT, 'research', 'design-references');
const OUT = resolve(DIR, 'screenshots');
const CDP = 'http://127.0.0.1:9222';

/**
 * Команда CDP.
 * @param {WebSocket} ws
 * @param {number} id
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>}
 */
function send(ws, id, method, params = {}) {
  return new Promise((done, reject) => {
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
    }, 60000);
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  РАБОТАЮТ ЛИ ФАЙЛЫ БЕЗ ИНТЕРНЕТА');
  console.log('='.repeat(70) + '\n');

  mkdirSync(OUT, { recursive: true });

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .sort();

  let fail = 0;

  for (const file of files) {
    const url = pathToFileURL(resolve(DIR, file)).href;
    process.stdout.write(`  ${file.padEnd(30)} `);

    let tab = null;
    let ws = null;
    try {
      const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      tab = await res.json();

      ws = await new Promise((done, reject) => {
        const s = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
        s.once('open', () => done(s));
        s.once('error', reject);
      });

      let id = 1;
      await send(ws, id++, 'Network.enable');

      // Собираем неудачные запросы: они означают внешнюю зависимость.
      const failed = [];
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg.method === 'Network.loadingFailed') failed.push(msg.params);
        } catch {
          /* не наш ответ */
        }
      });

      // Полная блокировка сети — как будто интернета нет.
      await send(ws, id++, 'Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });

      // Перезагружаем с уже включённым офлайном.
      await send(ws, id++, 'Page.enable');
      await send(ws, id++, 'Page.reload', { ignoreCache: true });
      await new Promise((r) => setTimeout(r, 2500));

      const stats = await send(ws, id++, 'Runtime.evaluate', {
        expression: `(() => ({
          svgs: document.querySelectorAll('svg').length,
          textLen: (document.body.innerText || '').length,
          font: getComputedStyle(document.body).fontFamily,
        }))()`,
        returnByValue: true,
      });
      const v = stats.result.value;

      const shot = await send(ws, id++, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      writeFileSync(
        resolve(OUT, file.replace(/\.html$/, '-offline.png')),
        Buffer.from(shot.data, 'base64'),
      );

      const external = failed.filter((f) => f.errorText !== 'net::ERR_ABORTED');
      if (external.length) {
        console.log(`ВНЕШНИЕ ЗАПРОСЫ: ${external.length} (${external[0].errorText})`);
        fail += 1;
      } else {
        console.log(`ок — ${v.svgs} иконок, ${v.textLen} символов, сеть не понадобилась`);
      }
    } catch (e) {
      console.log(`ОШИБКА: ${e?.message ?? e}`);
      fail += 1;
    } finally {
      if (ws) ws.close();
      if (tab?.id) {
        try {
          await fetch(`${CDP}/json/close/${tab.id}`);
        } catch {
          /* уже */
        }
      }
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`  проверено: ${files.length}`);
  console.log(`  нужен интернет: ${fail}`);
  console.log('-'.repeat(70) + '\n');

  if (fail === 0) {
    console.log('  ВСЕ ФАЙЛЫ АВТОНОМНЫ.');
    console.log('  Дизайнер может открыть их без интернета — вид не изменится.\n');
  }

  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
