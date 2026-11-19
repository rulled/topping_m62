/**
 * ТЕСТ: access-log.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Без логов нельзя понять, что происходит на публичном сайте: кто
 * получает 404, какие боты ломятся, не отдаём ли мы ошибки сотнями.
 *
 * Но логи не должны быть всегда: в разработке это шум. Поэтому они
 * включаются переменной `M62_ACCESS_LOG=1`.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. По умолчанию логов нет (не засоряем вывод разработки).
 *   2. С M62_ACCESS_LOG=1 каждая строка соответствует запросу.
 *   3. Формат содержит все нужные поля.
 *   4. X-Forwarded-For учитывается (за прокси свой IP бесполезен).
 *
 * ═══ ПОЧЕМУ ОТДЕЛЬНЫМ ПРОЦЕССОМ ═══
 *
 * Переменная читается при импорте модуля, поэтому менять её в том же
 * процессе поздно — нужен дочерний процесс.
 *
 * Запуск: node src/tools/test-access-log.js
 */

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/**
 * Поднять сервер в дочернем процессе.
 * @returns {Promise<{port:number, out:()=>string, stop:()=>Promise<void>}>}
 */
async function startServer(env) {
  const serverPath = new URL('../static-server.js', import.meta.url).pathname;
  // Windows: путь из URL приходит с ведущим слешем и %20
  const path = decodeURIComponent(serverPath.replace(/^\/([A-Za-z]:)/, '$1'));

  const child = spawn(process.execPath, [path], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  // Ждём порт из лога
  let port = 0;
  for (let i = 0; i < 60; i += 1) {
    await sleep(100);
    const m = out.match(/слушаю [\d.]+:(\d+)/);
    if (m) { port = Number(m[1]); break; }
  }

  return {
    port,
    out: () => out,
    stop: async () => {
      try { child.kill('SIGKILL'); } catch { /* уже */ }
      await sleep(100);
    },
  };
}

function get(port, path, headers = {}) {
  return new Promise((done) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers, agent: false, timeout: 5000 },
      (res) => { res.resume(); res.on('end', () => done(res.statusCode)); },
    );
    req.on('error', () => done(0));
    req.on('timeout', () => { req.destroy(); done(0); });
    req.end();
  });
}

async function main() {
  console.log('='.repeat(66));
  console.log('ACCESS-LOG');
  console.log('='.repeat(66));

  // ─── 1. по умолчанию логов нет ───
  console.log('\n--- 1. без переменной (по умолчанию) ---');
  let srv = await startServer({ M62_ACCESS_LOG: '' });
  if (!srv.port) {
    console.log('сервер не поднялся');
    process.exitCode = 1;
    return;
  }
  await get(srv.port, '/');
  await sleep(200);
  const quiet = srv.out();
  check('нет строк access-лога', !/"GET \/ HTTP/.test(quiet),
    quiet.trim().split('\n').slice(-2).join(' | '));
  await srv.stop();

  // ─── 2. с переменной логи есть ───
  console.log('\n--- 2. с M62_ACCESS_LOG=1 ---');
  srv = await startServer({ M62_ACCESS_LOG: '1' });
  if (!srv.port) {
    console.log('сервер не поднялся');
    process.exitCode = 1;
    return;
  }

  await get(srv.port, '/');
  await get(srv.port, '/src/protocol.js');
  await get(srv.port, '/no-such-page');
  await get(srv.port, '/health', { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' });
  await sleep(300);

  const logged = srv.out();
  const lines = logged.split('\n').filter((l) => /"GET /.test(l));

  check('записаны все 4 запроса', lines.length === 4, `${lines.length}`);

  // ─── 3. формат ───
  console.log('\n--- 3. формат строк ---');
  const first = lines[0] ?? '';
  check('есть IP', /^\d+\.\d+\.\d+\.\d+ - /.test(first), first.slice(0, 30));
  check('есть временная метка в формате nginx',
    /\[\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2} \+0000\]/.test(first));
  check('есть метод и путь', /"GET \/ HTTP\/1\.1"/.test(first));
  check('есть статус', /" 200 \d+ "/.test(first) || /" 200 \d+/.test(first));

  // ─── 4. статусы различаются ───
  console.log('\n--- 4. статусы в логе ---');
  check('200 присутствует', lines.some((l) => l.includes('" 200 ')));
  check('404 присутствует', lines.some((l) => l.includes('" 404 ')));

  // ─── 5. X-Forwarded-For ───
  console.log('\n--- 5. настоящий IP из X-Forwarded-For ---');
  const healthLine = lines.find((l) => l.includes('/health'));
  check('за прокси взят IP из X-Forwarded-For',
    !!healthLine && healthLine.startsWith('203.0.113.42'),
    healthLine?.slice(0, 40) ?? 'нет строки /health');

  // ─── 6. размер тела ───
  console.log('\n--- 6. размер тела в логе ---');
  const pageLine = lines.find((l) => /"GET \/ HTTP/.test(l));
  const sizeMatch = pageLine?.match(/" 200 (\d+) "/);
  check('указан размер тела', !!sizeMatch, sizeMatch?.[1] ?? '—');
  check('размер страницы разумный', Number(sizeMatch?.[1] ?? 0) > 5000,
    sizeMatch?.[1] ?? '—');

  await srv.stop();

  console.log(`\n${'='.repeat(66)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка теста:', e?.message ?? e);
  process.exitCode = 1;
});
