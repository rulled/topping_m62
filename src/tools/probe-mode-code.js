/**
 * ОТВЕТ HANDSHAKE = КОД РЕЖИМА.
 *
 * ═══ ЧТО НАЙДЕНО ═══
 *
 * Сверка Live и Prof (`probe-mode-dump.js --compare`) показала:
 *
 *     0x11:0x01 (handshake)  в Live = 2,  в Prof = 3
 *
 * То есть карта отвечает на handshake КОДОМ СВОЕГО РЕЖИМА, и это
 * самый надёжный способ узнать режим.
 *
 * Раньше режим определяли эвристикой по семействам HID
 * (`modes.js`): «есть 0xa1..0xaa -> Prof, есть 0x44 -> Live».
 * Эвристика ошибается: она требует полного дампа, а он приходит
 * не сразу и не всегда полный.
 *
 * Опубликованный драйвер это подтверждает словами: «The card answers
 * the handshake with its mode».
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
 *
 * Открывает сессию, читает ответ на handshake и печатает код.
 * Запускать в каждом режиме, чтобы собрать таблицу.
 *
 * НИЧЕГО НЕ ПЕРЕКЛЮЧАЕТ и не пишет.
 *
 * Запуск: node src/tools/probe-mode-code.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

/** Коды режимов, как мы их понимаем. */
const MODE_BY_CODE = { 1: 'Mobile', 2: 'Live Streaming', 3: 'Pro Audio' };

async function main() {
  console.log('='.repeat(70));
  console.log('КОД РЕЖИМА ИЗ ОТВЕТА HANDSHAKE');
  console.log('='.repeat(70));

  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });

  let hsAnswer = null;
  t.on('change', (ev) => {
    if (ev.target === 0x11 && ev.prop === 0x01) hsAnswer = ev.value;
  });

  await t.open();
  await sleep(8000);

  const snap = t.snapshot();

  // Эвристика по семействам — для сравнения
  const families = [...new Set(Object.keys(snap).map((k) => Number(String(k).split(':')[0])))]
    .sort((x, y) => x - y);
  const hasEqHp = families.some((f) => f >= 0xa1 && f <= 0xaa);
  const has44 = families.includes(0x44);
  const heuristic = hasEqHp ? 'Prof' : hasEqHp === false && has44 ? 'Live' : 'Mobile?';

  t.close();

  console.log(`\n  ответ handshake 0x11:0x01 = ${hsAnswer}`);
  console.log(`  режим по коду:   ${MODE_BY_CODE[hsAnswer] ?? 'НЕИЗВЕСТЕН'}`);
  console.log(`  режим по тегам:  ${heuristic}`);
  console.log(`  адресов: ${Object.keys(snap).length}, семейств: ${families.length}`);

  if (hsAnswer !== null && MODE_BY_CODE[hsAnswer]) {
    console.log('\n  Код режима работает. Использовать его, а не эвристику.');
  } else {
    console.log('\n  Код не распознан — проверить на других режимах.');
  }

  console.log(`
  Известные коды (по нашим замерам и тексту драйвера):
    1 = Mobile Mode
    2 = Live Streaming  (проверено: дамп 92 адреса, 15 семейств)
    3 = Pro Audio       (проверено: дамп 203 адреса, 37 семейств)
`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
