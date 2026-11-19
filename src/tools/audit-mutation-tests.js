/**
 * ПРОВЕРКА ЧЕСТНОСТИ ТЕСТОВ: МУТАЦИИ.
 *
 * ═══ КАКАЯ ПРОБЛЕМА ЛОВИТСЯ ═══
 *
 * Можно написать тест, который импортирует модуль и проверяет
 * `typeof fn === 'function'` — покрытие 100%, пользы ноль. Метрика
 * «файл упомянут в тестах» ничего не говорит о том, поймает ли
 * набор тестов реальную поломку.
 *
 * Честная проверка простая: сломать код и посмотреть, упадут ли
 * тесты. Если мутация прошла незамеченной — тест декоративный.
 *
 * ═══ КАК РАБОТАЕТ ═══
 *
 * Для каждой мутации:
 *   1. прочитать файл и убедиться, что образец найден ровно один раз;
 *   2. заменить образец на испорченный;
 *   3. запустить указанный набор тестов;
 *   4. ВСЕГДА вернуть файл обратно (в finally, даже при исключении);
 *   5. запомнить, упали ли тесты.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Мутации трогают ТОЛЬКО чистые функции протокола и шкал — те, что не
 * пишут на устройство. Ни одна мутация не может отправить кадр карте:
 * тесты работают на поддельных адаптерах.
 *
 * Перед изменением файла сохраняется его копия в памяти, после —
 * восстанавливается байт в байт. При Ctrl+C файл может остаться
 * испорченным; на этот случай в конце печатается `git checkout`.
 *
 * Запуск: node src/tools/audit-mutation-tests.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Мутация: сломать одно место и проверить, что тесты заметят.
 *
 * @typedef {object} Mutation
 * @property {string} file     путь относительно корня
 * @property {string} from     что заменить (должно встречаться ровно раз)
 * @property {string} to       на что заменить
 * @property {string} why      что именно ломается
 * @property {string} test     скрипт-проверка, который должен упасть
 */

/** @type {Mutation[]} */
const MUTATIONS = [
  {
    file: 'src/crc16.js',
    from: '^ 0xa001 : crc >>> 1',
    to: '^ 0xa002 : crc >>> 1',
    why: 'полином CRC16 — карта молча отбросит все кадры',
    test: 'src/tools/test-crc16.js',
  },
  {
    file: 'src/protocol.js',
    from: 'export const MAGIC_HEAD = [0x22, 0x33];',
    to: 'export const MAGIC_HEAD = [0x22, 0x34];',
    why: 'второй байт магического заголовка кадра',
    test: 'src/tools/test-browser-modules.js',
  },
  {
    file: 'src/gain-scales.js',
    from: 'if (step <= 79) return -88 + (step - 1) * 1;',
    to: 'if (step <= 79) return -87 + (step - 1) * 1;',
    why: 'смещение шкалы out_0 (BT/OTG): 0 дБ съедет на 1 дБ',
    test: 'src/tools/test-gain-scales.js',
  },
  {
    file: 'src/mutes-loopback.js',
    from: 'return v === 0; // 1 = mute -> звук не идёт',
    to: 'return v === 1; // 1 = mute -> звук не идёт',
    why: 'инверсия mute (в карте 1 = заглушено)',
    test: 'src/tools/test-mutes-loopback.js',
  },
];

/**
 * Запустить проверку, вернуть true, если она ПРОШЛА.
 * @param {string} script путь относительно корня
 * @returns {boolean}
 */
function runTest(script) {
  try {
    execFileSync(process.execPath, [resolve(ROOT, script)], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 120000,
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  ЧЕСТНОСТЬ ТЕСТОВ: ВНОСИМ ПОЛОМКИ И СМОТРИМ, ЗАМЕТЯТ ЛИ');
  console.log('='.repeat(70) + '\n');

  let caught = 0;
  const missed = [];
  const broken = [];
  const saved = new Map();

  for (const mut of MUTATIONS) {
    const abs = resolve(ROOT, mut.file);

    // Сохраняем оригинал ДО любых изменений.
    if (!saved.has(abs)) saved.set(abs, readFileSync(abs, 'utf8'));
    const original = /** @type {string} */ (saved.get(abs));

    const count = original.split(mut.from).length - 1;
    if (count !== 1) {
      console.log(`  ПРОПУСК  ${mut.file}: образец встречается ${count} раз (нужен 1)`);
      broken.push(`${mut.file}: ${mut.why}`);
      continue;
    }

    let passed;
    try {
      writeFileSync(abs, original.split(mut.from).join(mut.to), 'utf8');
      passed = runTest(mut.test);
    } finally {
      // Восстанавливаем ВСЕГДА, даже если тест упал или был таймаут.
      writeFileSync(abs, original, 'utf8');
    }

    if (passed) {
      console.log(`  НЕ ПОЙМАНА  ${mut.file}: ${mut.why}`);
      missed.push(`${mut.file}: ${mut.why}`);
    } else {
      console.log(`  поймана     ${mut.file}: ${mut.why}`);
      caught += 1;
    }
  }

  // Контрольная проверка: после восстановления тесты должны проходить.
  console.log('\n  контроль: файлы восстановлены, тесты снова должны быть зелёными');

  const controlFailed = MUTATIONS.filter((m) => !runTest(m.test)).map((m) => m.test);

  console.log('\n' + '-'.repeat(70));
  console.log(`  мутаций:            ${MUTATIONS.length}`);
  console.log(`  поймано:            ${caught}`);
  console.log(`  пропущено молча:    ${missed.length}`);
  console.log(`  не применилось:     ${broken.length}`);
  console.log('-'.repeat(70) + '\n');

  if (controlFailed.length) {
    console.log('  ВНИМАНИЕ: после восстановления эти проверки не проходят:');
    for (const t of [...new Set(controlFailed)]) console.log(`    ${t}`);
    console.log('  Скорее всего файл остался испорченным. Проверьте:');
    console.log('    git checkout -- src/');
    console.log('');
    process.exitCode = 1;
    return;
  }

  console.log('  Все файлы восстановлены, набор тестов зелёный.\n');

  if (missed.length) {
    console.log('  ЭТИ ПОЛОМКИ ТЕСТЫ НЕ ЗАМЕТИЛИ:');
    for (const m of missed) console.log(`    ${m}`);
    console.log('\n  Значит соответствующие проверки декоративные — их надо');
    console.log('  усилить, иначе они создают ложное чувство защиты.\n');
    process.exitCode = 1;
  } else if (broken.length) {
    console.log('  Часть мутаций не применилась (образец не найден) —');
    console.log('  это не провал тестов, но и не проверка. Обновите образцы.\n');
  } else {
    console.log('  КАЖДАЯ ПОЛОМКА ПОЙМАНА. Тесты проверяют поведение,');
    console.log('  а не факт существования функций.\n');
  }
}

main();
