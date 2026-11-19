/**
 * ТЕСТ: предупреждение при внешней привязке dev-сервера.
 *
 * ═══ ПОЧЕМУ ЭТО КРИТИЧНО ═══
 *
 * `src/server.js` — dev-сервер с 73 маршрутами БЕЗ АВТОРИЗАЦИИ:
 * управление картой, чтение реестра Windows, управление окнами MCC.
 *
 * По умолчанию он слушает 127.0.0.1 — наружу не виден. Но если
 * кто-то выставит `M62_HOST=0.0.0.0` (например, «чтобы зайти с
 * телефона»), сервер молча откроет управление оборудованием в
 * интернет.
 *
 * Нужно, чтобы он ГРОМКО предупредил. Этот тест проверяет, что
 * предупреждение реально печатается.
 *
 * ═══ КАК ПРОВЕРЯЕТСЯ ═══
 *
 * Запускаем сервер дочерним процессом с `M62_HOST=0.0.0.0` и
 * смотрим его вывод. Ждём несколько секунд и убиваем.
 *
 * Запуск: node src/tools/test-exposure-warning.js
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/** Запустить dev-сервер с заданным HOST и собрать вывод. */
async function runWithHost(host) {
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, M62_PORT: '8901', M62_HOST: host },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  await sleep(3000);
  try { child.kill('SIGKILL'); } catch { /* уже */ }
  await sleep(200);
  return out;
}

async function main() {
  console.log('='.repeat(70));
  console.log('ПРЕДУПРЕЖДЕНИЕ ПРИ ВНЕШНЕЙ ПРИВЯЗКЕ DEV-СЕРВЕРА');
  console.log('='.repeat(70));

  // ─── 1. внешний адрес: предупреждение обязательно ───
  console.log('\n--- 1. M62_HOST=0.0.0.0 ---');
  const exposed = await runWithHost('0.0.0.0');

  check('сервер запустился', /HTTP\s+http/.test(exposed),
    exposed.split('\n')[0]?.slice(0, 60));
  check('есть предупреждение о внешнем адресе',
    /ВНЕШНИЙ АДРЕС/.test(exposed));
  check('сказано, что НЕТ АВТОРИЗАЦИИ',
    /НЕТ АВТОРИЗАЦИИ/i.test(exposed));
  check('сказано, что кто угодно сможет управлять',
    /сможет управлять|Кто угодно/.test(exposed));
  check('предложен static-server как правильный вариант',
    /static-server\.js/.test(exposed));

  // ─── 2. localhost: предупреждения быть не должно ───
  console.log('\n--- 2. M62_HOST=127.0.0.1 (по умолчанию) ---');
  const local = await runWithHost('127.0.0.1');

  check('сервер запустился', /HTTP\s+http/.test(local));
  check('предупреждения о внешнем адресе НЕТ',
    !/ВНЕШНИЙ АДРЕС/.test(local));

  // ─── 3. сравнение ───
  console.log('\n--- 3. вывод отличается ---');
  check('вывод при 0.0.0.0 длиннее (добавилось предупреждение)',
    exposed.length > local.length,
    `${local.length} -> ${exposed.length} байт`);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  if (fail === 0) {
    console.log(`
  ЗАЩИТА РАБОТАЕТ: случайно выставить dev-сервер наружу без
  предупреждения нельзя.
`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
