/**
 * ПРОВЕРКА: серверный транспорт (transport.js) на живой карте.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `test-transport-core.js` проверяет БРАУЗЕРНЫЙ путь
 * (`transport-core.js`). А сервер использует ВТОРОЙ транспорт —
 * `transport.js`. Их политика продублирована, поэтому проверять надо
 * оба.
 *
 * Расхождение уже находили: `transport.js` не ждал ответ на handshake,
 * пока в `transport-core.js` это было исправлено. Если бы баг остался,
 * сервер терял бы часть записей молча.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. Устройство находится и открывается.
 *   2. Сессия открывается, состояние собирается (>80 адресов).
 *   3. Ответ на handshake приходит (значит ожидание работает).
 *   4. Запись работает: громкость HP записывается и читается в кеше.
 *   5. readFresh переоткрывает сессию и возвращает свежее состояние.
 *   6. После всех операций устройство возвращено в исходное состояние.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся перед изменениями. Меняем только громкость HP на
 * один шаг и возвращаем назад.
 *
 * Запуск: node src/tools/test-transport-node.js
 */

import { M62Transport } from '../transport.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

async function main() {
  console.log('='.repeat(70));
  console.log('СЕРВЕРНЫЙ ТРАНСПОРТ НА ЖИВОЙ КАРТЕ');
  console.log('='.repeat(70));

  // ─── 1. обнаружение ───
  console.log('\n--- 1. обнаружение ---');
  const info = M62Transport.find();
  check('устройство найдено', !!info, info ? `iface=${info.interface}` : 'нет');
  if (!info) {
    console.log('\nкарта не подключена — проверка невозможна');
    process.exitCode = 1;
    return;
  }
  check('это vendor-интерфейс (4)', info.interface === 4, String(info.interface));

  // ─── 2. открытие и сбор состояния ───
  console.log('\n--- 2. сессия ---');
  const t = new M62Transport({ logger: quiet });

  // Ловим ответ на handshake — он должен прийти ДО subscribe.
  let handshakeSeen = false;
  t.on('event', (ev) => {
    if (ev.target === 0x11 && ev.prop === 0x01) {
      handshakeSeen = true;
    }
  });

  const t0 = Date.now();
  // СТРАХОВКА: если open() зависнет, тест должен сообщить об этом,
  // а не молчать. Ожидание handshake имеет таймаут 3.5 с, плюс
  // запас на открытие HID — 15 с достаточно.
  const openResult = await Promise.race([
    t.open().then(() => 'ok'),
    sleep(15000).then(() => 'timeout'),
  ]);
  const openMs = Date.now() - t0;

  if (openResult === 'timeout') {
    check('сессия открылась', false, 'open() завис более 15 с');
    console.log('\n  ВАЖНО: open() не вернулся. Смотрим, дошли ли события:');
    console.log(`    handshake получен: ${handshakeSeen}`);
    console.log(`    адресов в снимке: ${Object.keys(t.snapshot()).length}`);
    console.log(`    статистика: ${JSON.stringify(t.stats)}`);
    try { t.close({ final: true }); } catch { /* уже */ }
    process.exitCode = 1;
    return;
  }

  check('сессия открылась', t.device !== null, `${openMs} мс`);
  check('ответ на handshake получен', handshakeSeen, String(handshakeSeen));

  // Ждём полный дамп.
  //
  // 9 секунд оказалось мало: после открытия пришло только 48
  // адресов. Полный дамп с EQ приходит позже (в Prof — до ~11 с),
  // а periodic announce идёт каждые 15 с. Ждём до появления EQ-блоков
  // или 16 с.
  let count = 0;
  for (let i = 0; i < 32; i += 1) {
    await sleep(500);
    const snap = t.snapshot();
    count = Object.keys(snap).length;
    // EQ-блоки 0x91..0x94 приходят только в полном дампе —
    // значит, если они есть, дамп точно пришёл.
    const hasEq = Object.keys(snap).some((k) => /^(14[5-8]):/.test(k));
    if (hasEq && count > 80) break;
  }
  check('состояние собрано (>80 адресов)', count > 80, `${count} адресов`);

  // ─── 3. безопасность ───
  console.log('\n--- 3. безопасность ---');
  const jack = t.get(0x64, 0x06);
  const mute = t.get(0x64, 0x04);
  console.log(`  наушники: jack=${jack} mute=${mute}`);
  const originalMute = mute;
  if (jack === 1 && mute !== 1) {
    t.writeFrames([{ target: 0x64, prop: 0x04, value: 1 },
      { target: 0x63, prop: 0x04, value: 1 }]);
    await sleep(1200);
    check('наушники заглушены', t.get(0x64, 0x04) === 1, String(t.get(0x64, 0x04)));
  } else {
    check('наушники уже безопасны', true, `jack=${jack} mute=${mute}`);
  }

  // ─── 4. запись ───
  console.log('\n--- 4. запись ---');
  const beforeVol = t.get(0x64, 0x03);
  console.log(`  громкость HP до: ${beforeVol}`);

  // Меняем на 1 шаг (проверено: 0..99, но реальный диапазон может
  // быть уже — берём безопасное значение).
  const targetVol = beforeVol === null ? 50 : Math.min(99, Math.max(1, beforeVol + 1));
  t.writeFrames([
    { target: 0x64, prop: 0x03, value: targetVol },
    { target: 0x63, prop: 0x03, value: targetVol },
  ]);
  await sleep(1500);
  const afterVol = t.get(0x64, 0x03);
  check('запись отражена в кеше', afterVol === targetVol,
    `${afterVol} (писали ${targetVol})`);

  // ─── 5. readFresh ───
  console.log('\n--- 5. чтение новой сессией ---');
  const fresh = await t.readFresh({ waitMs: 7000 });
  check('readFresh вернул снимок', fresh !== null,
    fresh ? `${Object.keys(fresh).length} адресов` : 'null');
  if (fresh) {
    const freshCount = Object.keys(fresh).length;
    check('в новой сессии тоже >80 адресов', freshCount > 80, String(freshCount));
    check('громкость подтверждена новой сессией',
      fresh['100:3'] === targetVol,
      `прочитано ${fresh['100:3']}, писали ${targetVol}`);
  }

  // ─── 6. откат ───
  console.log('\n--- 6. откат ---');
  if (beforeVol !== null) {
    t.writeFrames([
      { target: 0x64, prop: 0x03, value: beforeVol },
      { target: 0x63, prop: 0x03, value: beforeVol },
    ]);
    await sleep(1500);
    check('громкость возвращена', t.get(0x64, 0x03) === beforeVol,
      `${t.get(0x64, 0x03)} (было ${beforeVol})`);
  }
  if (originalMute === 0) {
    t.writeFrames([{ target: 0x64, prop: 0x04, value: 0 },
      { target: 0x63, prop: 0x04, value: 0 }]);
    await sleep(1000);
    console.log('  mute наушников возвращён в исходное');
  }

  t.close({ final: true });
  await sleep(500);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  пройдено: ${ok}`);
  console.log(`  провалено: ${fail}`);
  if (fail === 0) {
    console.log('\n  СЕРВЕРНЫЙ ТРАНСПОРТ РАБОТАЕТ.');
    console.log('  Ожидание handshake, запись и чтение новой сессией — в порядке.');
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('ошибка:', e?.message ?? e);
  process.exitCode = 1;
});
