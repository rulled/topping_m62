/**
 * ЗАПУСК tsc БЕЗ ПРЕДУПРЕЖДЕНИЙ.
 *
 * ═══ ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ ═══
 *
 * `typecheck.js` должен запустить tsc и прочитать его вывод. На
 * Windows это нетривиально:
 *
 *   • `execFileSync('node_modules/.bin/tsc.cmd', ...)` НЕ работает —
 *     .cmd не запускается без shell (код возврата null, пустой вывод);
 *   • `execFileSync('npx', ..., { shell: true })` работает, но даёт
 *     DEP0190 — предупреждение про небезопасное экранирование
 *     аргументов. Аргументы у нас фиксированные, но предупреждение
 *     засоряет вывод и пугает пользователя.
 *
 * Решение: этот файл запускает tsc через `npm exec` посредством
 * shell ОДИН раз и печатает результат в stdout. `typecheck.js` читает
 * его вывод обычным `execFileSync` без shell.
 *
 * Запуск: node src/tools/_run-tsc.js
 */

import { spawnSync } from 'node:child_process';

// spawnSync с shell: true внутри этого процесса — единственное место,
// где предупреждение DEP0190 подавлено через переменную окружения.
// Аргументы фиксированные, пользовательского ввода нет.
const r = spawnSync('npx', ['tsc', '-p', 'jsconfig.json'], {
  encoding: 'utf8',
  shell: true,
  timeout: 180000,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});

if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr && !/DEP0190/.test(r.stderr)) process.stderr.write(r.stderr);

// tsc возвращает 1 при наличии ошибок — для нас это нормальный
// результат, а не сбой запуска.
process.exit(r.status ?? 0);
