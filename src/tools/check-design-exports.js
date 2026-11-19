/**
 * ПРОВЕРКА ВЫГРУЖЕННЫХ ДИЗАЙНОВ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Файл может сохраниться без внешних ссылок, но выглядеть иначе:
 * шрифт не подхватился, иконки пропали, стили не применились.
 * Проверять надо глазами — поэтому здесь снимается скриншот.
 *
 * ═══ КАК РАБОТАЕТ ═══
 *
 * Для каждого HTML-файла:
 *   1. открываем его в отдельной вкладке Chrome (file://);
 *   2. ждём, пока отработают скрипты;
 *   3. считаем SVG, проверяем шрифт, снимаем скриншот;
 *   4. закрываем вкладку.
 *
 * Запуск: node src/tools/check-design-exports.js
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WebSocket } from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = resolve(ROOT, 'research', 'design-references');
const SHOTS = resolve(DIR, 'screenshots');
const CDP = 'http://127.0.0.1:9222';

/**
 * Отправить команду CDP и дождаться результата.
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

/**
 * Открыть вкладку с файлом и вернуть её webSocket-адрес.
 * @param {string} fileUrl
 * @returns {Promise<any>}
 */
async function openTab(fileUrl) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(fileUrl)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`не открылась вкладка: ${res.status}`);
  return res.json();
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  ПРОВЕРКА ВЫГРУЖЕННЫХ ДИЗАЙНОВ');
  console.log('='.repeat(70) + '\n');

  mkdirSync(SHOTS, { recursive: true });

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .sort();

  if (files.length === 0) {
    console.log('  нет выгруженных файлов\n');
    process.exitCode = 1;
    return;
  }

  let fail = 0;

  for (const file of files) {
    const abs = resolve(DIR, file);
    const url = pathToFileURL(abs).href;
    process.stdout.write(`  ${file.padEnd(30)} `);

    let tab = null;
    let ws = null;
    try {
      tab = await openTab(url);
      ws = await new Promise((done, reject) => {
        const s = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
        s.once('open', () => done(s));
        s.once('error', reject);
      });

      let id = 1;
      // Ждём загрузки и отрисовки.
      await send(ws, id++, 'Page.enable');
      await new Promise((r) => setTimeout(r, 2500));

      const stats = await send(ws, id++, 'Runtime.evaluate', {
        expression: `(() => {
          const cs = getComputedStyle(document.body);
          return {
            title: document.title,
            svgs: document.querySelectorAll('svg').length,
            fontFamily: cs.fontFamily,
            bodyBg: cs.backgroundColor,
            textLen: (document.body.innerText || '').length,
            scrollH: document.documentElement.scrollHeight,
          };
        })()`,
        returnByValue: true,
      });
      const v = stats.result.value;

      // Скриншот всей страницы.
      const shot = await send(ws, id++, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      const pngName = file.replace(/\.html$/, '.png');
      writeFileSync(resolve(SHOTS, pngName), Buffer.from(shot.data, 'base64'));

      const problems = [];
      if (v.svgs === 0) problems.push('нет SVG-иконок');
      if (v.textLen < 20) problems.push(`мало текста (${v.textLen})`);
      if (/serif|Times/i.test(v.fontFamily) && !/sans/i.test(v.fontFamily)) {
        problems.push(`шрифт похож на подменённый: ${v.fontFamily.slice(0, 40)}`);
      }

      if (problems.length) {
        console.log(`ЗАМЕЧАНИЯ: ${problems.join('; ')}`);
        fail += 1;
      } else {
        console.log(`ок — ${v.svgs} иконок, ${v.textLen} символов, скриншот ${pngName}`);
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
          /* уже закрыта */
        }
      }
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`  проверено: ${files.length}`);
  console.log(`  с замечаниями: ${fail}`);
  console.log(`  скриншоты: ${SHOTS}`);
  console.log('-'.repeat(70) + '\n');

  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
