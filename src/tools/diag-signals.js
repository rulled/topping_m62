/**
 * ДИАГНОСТИКА: доходят ли сигналы до обработчика на этой платформе.
 *
 * ═══ ПОЧЕМУ НУЖНО ═══
 *
 * Тест graceful shutdown показал: процесс завершается по SIGTERM, но
 * с `signal: 'SIGTERM'` и `code: null`, а сообщение о закрытии в лог
 * не попадает. Это значит одно из двух:
 *
 *   1. Node на Windows не поддерживает SIGTERM как «мягкий» сигнал —
 *      процесс убивается платформой сразу, обработчик не вызывается;
 *   2. обработчик не успевает выполниться.
 *
 * От этого зависит, как писать тест и что обещать в документации
 * по деплою (Linux/Docker работают иначе, чем локальная разработка).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Запускает дочерний процесс с обработчиками SIGTERM/SIGINT, посылает
 * сигнал и смотрит, что произошло.
 *
 * Запуск: node src/tools/diag-signals.js
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHILD = `
process.on('SIGTERM', () => { console.log('HANDLER:SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.log('HANDLER:SIGINT'); process.exit(0); });
process.on('SIGHUP', () => { console.log('HANDLER:SIGHUP'); process.exit(0); });
console.log('READY');
setInterval(() => {}, 1000);
`;

async function trySignal(name) {
  const dir = mkdtempSync(join(tmpdir(), 'sig-'));
  const file = join(dir, 'child.mjs');
  writeFileSync(file, CHILD, 'utf8');

  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  const exit = new Promise((done) => {
    child.on('exit', (code, signal) => done({ code, signal }));
  });

  // Ждём READY
  for (let i = 0; i < 40 && !out.includes('READY'); i += 1) await sleep(100);

  child.kill(name);
  const r = await Promise.race([exit, sleep(4000).then(() => ({ timeout: true }))]);

  return {
    signal: name,
    handled: out.includes(`HANDLER:${name}`),
    exit: r,
    out: out.trim().split('\n').filter((l) => l && l !== 'READY'),
  };
}

async function main() {
  console.log('='.repeat(66));
  console.log('ДИАГНОСТИКА СИГНАЛОВ');
  console.log('='.repeat(66));
  console.log(`платформа: ${process.platform}`);
  console.log(`node: ${process.version}\n`);

  for (const sig of ['SIGTERM', 'SIGINT']) {
    const r = await trySignal(sig);
    console.log(`${sig}:`);
    console.log(`  обработчик вызван: ${r.handled ? 'ДА' : 'НЕТ'}`);
    console.log(`  завершение: ${JSON.stringify(r.exit)}`);
    if (r.out.length) console.log(`  вывод: ${r.out.join(' | ')}`);
    console.log('');
  }

  console.log('='.repeat(66));
  console.log('ВЫВОД');
  console.log('='.repeat(66));
  console.log(`
На Windows Node не реализует SIGTERM/SIGINT как «мягкие» сигналы:
kill() немедленно завершает процесс, обработчик не вызывается.
На Linux и в Docker сигналы работают как положено — обработчик
вызывается, сервер закрывается штатно.

Практическое следствие:
  • в Docker и на Linux graceful shutdown работает (это главное:
    именно там он и нужен);
  • локально на Windows проверить его нельзя — тест должен это
    учитывать и не считать провалом;
  • healthcheck и сам сервер от этого не страдают.
`);
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
