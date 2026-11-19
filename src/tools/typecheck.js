/**
 * ПРОВЕРКА ТИПОВ С ХРАПОВИКОМ.
 *
 * ═══ ПОЧЕМУ ХРАПОВИК, А НЕ ПРОСТО tsc ═══
 *
 * TypeScript умеет проверять обычный JS по JSDoc. Но на этом проекте
 * он даёт **123 замечания**, и почти все — ограничения вывода типов,
 * а не ошибки:
 *
 *   • объект строится в цикле из массива имён — TS не знает, что
 *     все поля появятся;
 *   • `$('id')` возвращает `HTMLElement`, у которого нет `.value`
 *     (хотя по факту это `HTMLInputElement`);
 *   • интерфейс адаптера описан объектным литералом без `reopen`.
 *
 * Требовать исправить всё сразу — значит потратить дни на аннотации
 * ради подавления шума.
 *
 * НО и выключать проверку неправильно: она ловит реальные опечатки
 * («свойства `targt` не существует»).
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
 *
 * Считает число замечаний и сравнивает с сохранённым значением:
 *   • стало БОЛЬШЕ — ошибка (появились новые проблемы);
 *   • стало МЕНЬШЕ — обновляет базу (прогресс зафиксирован);
 *   • столько же — всё в порядке.
 *
 * Так новые ошибки не проходят, а старые можно чинить постепенно.
 *
 * ═══ ЗАПУСК ═══
 *
 *     node src/tools/typecheck.js           # проверить
 *     node src/tools/typecheck.js --update  # обновить базу
 *     node src/tools/typecheck.js --list    # показать все замечания
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASELINE_FILE = 'research/typecheck-baseline.json';

const args = process.argv.slice(2);
const update = args.includes('--update');
const list = args.includes('--list');

/** Запустить tsc и вернуть список замечаний. */
function runTsc() {
  let out = '';
  try {
    // Запускаем tsc через файл-обёртку `_run-tsc.js`.
    //
    // Почему не напрямую: на Windows `node_modules/.bin/tsc.cmd` не
    // стартует без shell (код возврата null, пустой вывод), а
    // `shell: true` даёт предупреждение DEP0190. Обёртка решает оба
    // вопроса: она запускает tsc один раз и печатает вывод, а здесь
    // мы читаем его обычным execFileSync без shell.
    out = execFileSync(process.execPath, ['src/tools/_run-tsc.js'], {
      encoding: 'utf8',
      timeout: 180000,
    });
  } catch (err) {
    // tsc возвращает ненулевой код при ошибках — это нормально.
    out = String(err.stdout ?? '') + String(err.stderr ?? '');
  }

  const errors = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    if (!m) continue;
    // Замечания из node_modules не наши.
    if (m[1].includes('node_modules')) continue;
    errors.push({
      file: m[1],
      line: Number(m[2]),
      code: m[4],
      message: m[5],
    });
  }
  return errors;
}

/** Сгруппировать по файлам для читаемого вывода. */
function groupByFile(errors) {
  const map = new Map();
  for (const e of errors) {
    if (!map.has(e.file)) map.set(e.file, []);
    map.get(e.file).push(e);
  }
  return [...map].sort((a, b) => b[1].length - a[1].length);
}

function main() {
  console.log('='.repeat(70));
  console.log('ПРОВЕРКА ТИПОВ (храповик)');
  console.log('='.repeat(70));

  const errors = runTsc();
  const current = errors.length;

  console.log(`\nзамечаний сейчас: ${current}`);

  // ─── список ───
  if (list || current > 0) {
    const groups = groupByFile(errors);
    console.log(`\nпо файлам (${groups.length}):`);
    for (const [file, list_] of groups) {
      console.log(`  ${file}: ${list_.length}`);
      for (const e of list_.slice(0, 3)) {
        console.log(`      ${e.line}: ${e.message.slice(0, 70)}`);
      }
      if (list_.length > 3) console.log(`      ... ещё ${list_.length - 3}`);
    }
  }

  // ─── база ───
  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : null;

  if (update) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify({
      count: current,
      updatedAt: new Date().toISOString(),
      note: 'Число замечаний tsc. Храповик: новые ошибки не проходят, старые можно чинить постепенно.',
      byFile: Object.fromEntries(groupByFile(errors).map(([f, l]) => [f, l.length])),
    }, null, 2)}\n`, 'utf8');
    console.log(`\nбаза обновлена: ${current} замечаний`);
    return 0;
  }

  if (!baseline) {
    console.log(`\nбазы нет — создаю (${current})`);
    writeFileSync(BASELINE_FILE, `${JSON.stringify({
      count: current,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    return 0;
  }

  console.log(`\nв базе: ${baseline.count}`);

  // ─── сравнение ───
  console.log(`\n${'='.repeat(70)}`);
  if (current > baseline.count) {
    console.log('РЕЗУЛЬТАТ: ЗАМЕЧАНИЙ СТАЛО БОЛЬШЕ');
    console.log('='.repeat(70));
    console.log(`\n  было ${baseline.count}, стало ${current} (+${current - baseline.count})`);
    console.log('\n  Появились новые проблемы. Посмотрите список выше.');
    console.log('  Если они ложные — обновите базу: --update');
    process.exitCode = 1;
    return 1;
  }

  if (current < baseline.count) {
    console.log('РЕЗУЛЬТАТ: СТАЛО МЕНЬШЕ — ХОРОШО');
    console.log('='.repeat(70));
    console.log(`\n  было ${baseline.count}, стало ${current} (−${baseline.count - current})`);
    writeFileSync(BASELINE_FILE, `${JSON.stringify({
      count: current,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    console.log('  база обновлена');
    return 0;
  }

  console.log('РЕЗУЛЬТАТ: БЕЗ ИЗМЕНЕНИЙ');
  console.log('='.repeat(70));
  console.log(`\n  ${current} замечаний — столько же, сколько в базе.`);
  console.log('  Новых ошибок нет.');
  return 0;
}

process.exitCode = main();
