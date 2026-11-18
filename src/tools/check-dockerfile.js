/**
 * ТЕСТ: Docker-файл копирует все файлы из белого списка.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * В `Dockerfile` файлы перечислены через COPY поимённо. В
 * `static-server.js` — через белый список. Это два независимых
 * списка, и они могут разойтись.
 *
 * Если добавить модуль в белый список, но забыть COPY — контейнер
 * соберётся, запустится, и будет отдавать 500 на этот модуль. Причём
 * только в проде: локально всё работает, файл-то на диске есть.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Каждый файл из белого списка есть в Dockerfile (COPY).
 *   2. В Dockerfile нет COPY того, чего нет на диске.
 *   3. Healthcheck в Dockerfile бьёт по /health, который сервер
 *      поддерживает.
 *   4. CMD в exec-форме (иначе SIGTERM не дойдёт до node).
 *
 * Запуск: node src/tools/check-dockerfile.js
 */

import { existsSync, readFileSync } from 'node:fs';

import { ALLOWED_FILES } from '../static-server.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

const DOCKERFILE = 'Dockerfile';

function main() {
  console.log('='.repeat(66));
  console.log('DOCKERFILE: СОГЛАСОВАННОСТЬ С БЕЛЫМ СПИСКОМ');
  console.log('='.repeat(66));

  if (!existsSync(DOCKERFILE)) {
    console.log('\nDockerfile не найден');
    process.exitCode = 1;
    return;
  }

  const df = readFileSync(DOCKERFILE, 'utf8');

  // ─── 1. все файлы из белого списка копируются ───
  //
  // В белом списке есть алиасы ('/' и '/index.html' -> один файл).
  // Собираем уникальные пути на диске.
  const needed = new Set(ALLOWED_FILES.values());
  console.log(`\nфайлов в белом списке (уникальных): ${needed.size}\n`);

  const notCopied = [];
  for (const path of needed) {
    // Ищем COPY с этим путём. Dockerfile пишет через / как разделитель.
    const re = new RegExp(`^COPY\\s+${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`,
      'm');
    if (!re.test(df)) notCopied.push(path);
  }
  check(`все ${needed.size} файлов копируются в образ`,
    notCopied.length === 0, notCopied.join(', '));

  // ─── 2. нет COPY несуществующих файлов ───
  const copies = [...df.matchAll(/^COPY\s+(\S+)\s/gm)].map((m) => m[1]);
  const missingOnDisk = copies.filter((p) => !existsSync(p) && !p.includes('*'));
  check('нет COPY несуществующих файлов', missingOnDisk.length === 0,
    missingOnDisk.join(', '));

  // ─── 3. healthcheck ───
  const hasHealth = /^HEALTHCHECK/m.test(df);
  check('есть HEALTHCHECK', hasHealth);
  check('healthcheck бьёт по /health', df.includes('/health'));

  // ─── 4. CMD в exec-форме ───
  const cmdMatch = df.match(/^CMD\s+(.+)$/m);
  check('есть CMD', !!cmdMatch);
  check('CMD в exec-форме (массив), иначе SIGTERM не дойдёт до node',
    !!cmdMatch && cmdMatch[1].trim().startsWith('['),
    cmdMatch?.[1]?.trim().slice(0, 40) ?? '');

  // ─── 5. не от root ───
  check('запуск от непривилегированного пользователя', /^USER\s+(?!root)/m.test(df));

  // ─── 6. EXPOSE соответствует PORT ───
  const expose = df.match(/^EXPOSE\s+(\d+)/m);
  const portEnv = df.match(/^ENV\s+PORT=(\d+)/m);
  check('EXPOSE указан', !!expose, expose?.[1] ?? '');
  if (expose && portEnv) {
    check('EXPOSE совпадает с PORT', expose[1] === portEnv[1],
      `${expose[1]} vs ${portEnv[1]}`);
  }

  console.log(`\n${'='.repeat(66)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main();
