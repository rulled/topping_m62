/**
 * ОБЩИЙ ПОДЪЁМ СЕРВЕРА ДЛЯ ТЕСТОВ.
 *
 * ═══ КАКАЯ ПРОБЛЕМА БЫЛА ═══
 *
 * Часть проверок ходит на `http://127.0.0.1:<PORT>/`, ожидая, что
 * сервер уже кем-то поднят. В итоге `npm run test:server` с чистого
 * листа падал на «нет ответа» — и выглядело это как поломка вёрстки
 * или модулей, хотя сервер просто не был запущен.
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ МОДУЛЬ ═══
 *
 * Поднимает static-server на время проверки и отдаёт функцию
 * закрытия. Если порт уже занят — использует чужой сервер и НЕ
 * закрывает его: проверки можно гонять подряд, и они не будут
 * гасить сервер, поднятый вручную.
 *
 * ═══ ПОЧЕМУ ПРОВЕРКА ЧЕРЕЗ ПОРТ, А НЕ ПО PID ═══
 *
 * Занятость порта — единственное, что реально важно потребителю:
 * можно ли уже делать запросы. Проверка через connect честнее, чем
 * `child.on('spawn')`: процесс может стартовать, но ещё не слушать.
 */

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Слушает ли кто-нибудь порт.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function portBusy(port) {
  return new Promise((done) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    sock.once('connect', () => { sock.destroy(); done(true); });
    sock.once('error', () => { sock.destroy(); done(false); });
    sock.setTimeout(1500, () => { sock.destroy(); done(false); });
  });
}

/**
 * Поднять сервер, если порт свободен.
 *
 * @param {number} port
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{owned: boolean, close: () => Promise<void>}>}
 */
export async function ensureServer(port, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (await portBusy(port)) {
    return { owned: false, close: async () => {} };
  }

  const child = spawn(process.execPath, [resolve(ROOT, 'src', 'static-server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), M62_QUIET: '1' },
    stdio: 'ignore',
  });

  let exited = false;
  child.once('exit', () => { exited = true; });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portBusy(port)) break;
    if (exited) throw new Error(`сервер завершился, не начав слушать :${port}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!(await portBusy(port))) {
    try { child.kill(); } catch { /* уже */ }
    throw new Error(`сервер не поднялся на :${port} за ${timeoutMs} мс`);
  }

  return {
    owned: true,
    close: async () => {
      try { child.kill(); } catch { /* уже */ }
    },
  };
}
