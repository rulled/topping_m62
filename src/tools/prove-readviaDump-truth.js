/**
 * ЛОЖНОЕ ПОДТВЕРЖДЕНИЕ? readViaDump В ТОЙ ЖЕ СЕССИИ.
 *
 * ═══ ЧТО СТАЛО ЯСНО ═══
 *
 * Тест `prove-announce-eq-rule.js` доказал:
 *
 *     announce #1 в новой сессии: EQ-адресов 40
 *     announce #2 в той же сессии: EQ-адресов 0
 *     announce #3 в той же сессии: EQ-адресов 0
 *
 * Значит повторный announce в той же сессии EQ НЕ возвращает.
 *
 * ═══ ПОЧЕМУ ЭТО ОПАСНО ДЛЯ НАШЕГО КОДА ═══
 *
 * `M62TransportCore.readViaDump()` шлёт announce в УЖЕ ОТКРЫТОЙ
 * сессии и через 3.5 с возвращает `this.snapshot()` — то есть КЕШ.
 *
 * Если кеш не обновился (а он не обновится, потому что повторный
 * announce ничего не даёт), функция вернёт СТАРЫЕ значения. А
 * `writeEqWithCommit()` перед этим оптимистично положил в кеш наши
 * значения. Получается:
 *
 *     пишем gain = 4  -> кеш: 4 -> readViaDump вернёт 4 ->
 *     «ПРИМЕНЕНО» (хотя карта могла не принять)
 *
 * Это ровно тот класс ошибки, который в §151 стоил ложного вывода
 * «EQ не пишется». Теперь он может стоить ложного «пишется».
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ЭТОТ ТЕСТ ═══
 *
 * 1. Пишет заведомо отличимое значение через ядро (кеш обновляется).
 * 2. Сразу спрашивает readViaDump (та же сессия) -> что вернёт?
 * 3. Открывает НОВУЮ сессию и читает правду.
 * 4. Сравнивает: если readViaDump соврал, значения разойдутся.
 *
 * Для чистоты пишем значение, которого НЕ было ранее (7 дБ).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Значение откатывается.
 * Запись EQ требует удержания сессии — используется штатный метод.
 *
 * Запуск: node src/tools/prove-readviaDump-truth.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const TEST_GAIN = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

/** Правда о 0x91:0x03 в НОВОЙ сессии (независимое соединение). */
async function truthFresh() {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(7000); // первый announce отрабатывает за ~5-7 с
  const v = t.get(0x91, 0x03);
  const eqCount = Object.keys(t.snapshot()).filter((k) => /^(145|146|147|148):/.test(k)).length;
  t.close();
  await sleep(1500);
  return { gain: v, eqCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('ПРОВЕРКА: НЕ ВРЁТ ЛИ readViaDump (кеш вместо правды)?');
  console.log('='.repeat(70));

  // ─── исходное ───
  const before = await truthFresh();
  console.log(`\nисходное (новая сессия): gain=${before.gain}, EQ-адресов=${before.eqCount}`);

  // ─── безопасность ───
  const a0 = createNodeHidAdapter({ logger: quiet });
  const t0 = new M62TransportCore({ adapter: a0, logger: quiet });
  await t0.open();
  await sleep(6000);
  const jack = t0.get(0x64, 0x06);
  const mute = t0.get(0x64, 0x04);
  console.log(`наушники: jack=${jack} mute=${mute}`);
  if (jack === 1 && mute !== 1) {
    t0.writeFrames([{ target: 0x64, prop: 0x04, value: 1 }]);
    await sleep(1500);
    if (t0.get(0x64, 0x04) !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      t0.close();
      process.exit(1);
    }
    console.log('  заглушено');
  }
  t0.close();
  await sleep(1500);

  // ─── ГЛАВНЫЙ ТЕСТ ───
  console.log('\n' + '-'.repeat(70));
  console.log(`открываю сессию, пишу gain = ${TEST_GAIN}, читаю readViaDump`);
  console.log('-'.repeat(70));

  const a1 = createNodeHidAdapter({ logger: quiet });
  const t1 = new M62TransportCore({ adapter: a1, logger: quiet });
  await t1.open();
  await sleep(6000);

  console.log(`  до записи: кеш даёт gain = ${t1.get(0x91, 0x03)}`);

  // пишем штатным методом: он ещё и кеш обновляет
  await t1.writeEqWithCommit([{ target: 0x91, prop: 0x03, value: TEST_GAIN }]);

  // читаем через readViaDump В ТОЙ ЖЕ сессии
  const sameSession = await t1.readViaDump();
  const gainSame = sameSession['145:3'];
  const eqInSame = Object.keys(sameSession).filter((k) => /^(145|146|147|148):/.test(k)).length;
  console.log(`  readViaDump (та же сессия): gain=${gainSame}, EQ-адресов=${eqInSame}`);
  console.log(`  __dumpComplete = ${sameSession.__dumpComplete}`);
  t1.close();
  await sleep(2000);

  // ─── правда ───
  const after = await truthFresh();
  console.log(`  правда (новая сессия):      gain=${after.gain}, EQ-адресов=${after.eqCount}`);

  // ─── откат ───
  console.log('\nоткат…');
  const a2 = createNodeHidAdapter({ logger: quiet });
  const t2 = new M62TransportCore({ adapter: a2, logger: quiet });
  await t2.open();
  await sleep(6000);
  await t2.writeEqWithCommit([{ target: 0x91, prop: 0x03, value: before.gain ?? 0 }]);
  t2.close();
  await sleep(2000);
  const fin = await truthFresh();
  console.log(`  после отката: gain=${fin.gain}`);

  // ─── ВЕРДИКТ ───
  console.log('\n' + '='.repeat(70));
  console.log('ВЕРДИКТ');
  console.log('='.repeat(70));
  console.log(`  readViaDump (кеш):  ${gainSame}`);
  console.log(`  правда:             ${after.gain}`);
  console.log('');

  const ok = after.gain === TEST_GAIN;
  const sameSessionSaysOk = gainSame === TEST_GAIN;

  if (ok) {
    console.log(`  ЗАПИСЬ РЕАЛЬНО ПРИМЕНИЛАСЬ (карта подтвердила ${TEST_GAIN}).`);
  } else {
    console.log(`  ЗАПИСЬ НЕ ПРИМЕНИЛАСЬ (в карте ${after.gain}, писали ${TEST_GAIN}).`);
  }

  if (sameSessionSaysOk && !ok) {
    console.log('  >>> readViaDump СОВРАЛ: вернул кеш, а не правду.');
    console.log('  >>> Это надо исправить: readViaDump обязан требовать');
    console.log('      НОВУЮ сессию, иначе даёт ложные подтверждения.');
  } else if (sameSessionSaysOk && ok) {
    console.log('  readViaDump совпал с правдой — но ЭТО СОВПАДЕНИЕ:');
    console.log('  повторный announce в той же сессии EQ не возвращает,');
    console.log('  значит значение пришло из кеша, который мы сами обновили.');
    console.log('  Логика верна случайно, а не по устройству.');
  } else {
    console.log('  readViaDump не дал подтверждения.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
