/**
 * ПРОВЕРКА НА КАРТЕ: когда приходит ответ на handshake и что в 0x11:0x18.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Из опубликованного драйвера ядра (патч 5/8, см.
 * `research/CONTROLS-MAP.md`):
 *
 *   1. «Nothing follows the handshake until it is answered. The card
 *      answers 0x11/0x01 8 to 851 ms after it… a write that reached the
 *      card 2 ms before the answer was not applied.»
 *
 * Мы в `transport-core.js` ждём ФИКСИРОВАННЫЕ 400 мс. Если карта
 * отвечает позже — часть записей теряется. Надо замерить на своей
 * карте, а не верить чужому числу.
 *
 *   2. «0x11/0x18» — по драйверу это **уровень батареи в процентах**
 *      (0..100), а не счётчик сессии, как записано у нас в NOTES §159.
 *
 * ═══ МЕТОД ═══
 *
 * Создаём ядро с адаптером, но НЕ зовём open() (он сам шлёт
 * handshake). Вместо этого шлём handshake вручную и засекаем время
 * до ответа.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Шлём только handshake/subscribe/announce — они обязательны для
 * любой сессии и ничего не меняют в настройках.
 *
 * Запуск: node src/tools/prove-handshake-timing.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

async function runTrial(_trialNo) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });

  let sentAt = 0;
  let answeredAt = 0;
  const battery = [];

  t.on('change', (ev) => {
    if (ev.target === 0x11 && ev.prop === 0x01 && sentAt && !answeredAt) {
      answeredAt = Date.now();
    }
    if (ev.target === 0x11 && ev.prop === 0x18) {
      battery.push(ev.value);
    }
  });

  // Адаптер уже слушает (это делает конструктор ядра).
  await sleep(300);

  sentAt = Date.now();
  t.send(0x11, 0x01, 1);

  // Ждём ответ до 4 с
  for (let i = 0; i < 80; i += 1) {
    await sleep(50);
    if (answeredAt) break;
  }

  const elapsed = answeredAt ? answeredAt - sentAt : null;

  // Дальше — обычная сессия
  t.send(0x11, 0x24, 1);
  await sleep(250);
  t.send(0x11, 0x26, 1);

  await sleep(8000);

  const snap = t.snapshot();
  t.close();
  await sleep(1500);

  return { elapsed, battery, tagCount: Object.keys(snap).length };
}

async function main() {
  console.log('='.repeat(70));
  console.log('HANDSHAKE: КОГДА ОТВЕТ, И ЧТО ТАКОЕ 0x11:0x18');
  console.log('='.repeat(70));

  const times = [];
  const allBattery = [];
  const tagCounts = [];

  // Три попытки: время ответа может зависеть от того, что карта делает
  for (let n = 1; n <= 3; n += 1) {
    console.log(`\n--- попытка ${n} ---`);
    const r = await runTrial(n);
    if (r.elapsed === null) {
      console.log('  ответ на handshake НЕ пришёл за 4 с');
    } else {
      console.log(`  ответ через ${r.elapsed} мс, адресов: ${r.tagCount}`);
      times.push(r.elapsed);
    }
    tagCounts.push(r.tagCount);
    allBattery.push(...r.battery);

    if (r.battery.length) {
      const uniq = [...new Set(r.battery)];
      console.log(`  0x11:0x18 = ${uniq.join(', ')}`);
    }
  }

  // ─── результаты ───
  console.log('\n' + '='.repeat(70));
  console.log('РЕЗУЛЬТАТЫ');
  console.log('='.repeat(70));

  if (times.length) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = Math.round(times.reduce((s, x) => s + x, 0) / times.length);
    console.log(`\n  ответ на handshake: min ${min} мс, max ${max} мс, среднее ${avg} мс`);
    if (max > 400) {
      console.log('\n  ⚠ МАКСИМУМ БОЛЬШЕ 400 мс — наша фиксированная пауза МАЛА.');
      console.log('    Правильно: ждать сам ответ (или 3.5 с), а не время.');
    } else {
      console.log('\n  400 мс хватает, но надёжнее ждать сам ответ.');
    }
  } else {
    console.log('\n  ни одна попытка не получила ответ');
  }

  console.log('\n' + '-'.repeat(70));
  console.log('0x11:0x18 — БАТАРЕЯ ИЛИ СЧЁТЧИК?');
  console.log('-'.repeat(70));

  if (!allBattery.length) {
    console.log('  значения не пришли');
  } else {
    const uniq = [...new Set(allBattery)].sort((x, y) => x - y);
    console.log(`  событий: ${allBattery.length}, уникальных: ${uniq.length}`);
    console.log(`  значения: ${uniq.join(', ')}`);

    const allInRange = uniq.every((v) => v >= 0 && v <= 100);
    const monotonic = allBattery.every((v, i, arr) => i === 0 || v >= arr[i - 1]);

    console.log(`  все в 0..100: ${allInRange ? 'ДА' : 'НЕТ'}`);
    console.log(`  монотонно растёт: ${monotonic ? 'ДА' : 'НЕТ'}`);

    if (allInRange) {
      console.log('\n  Это ПРОЦЕНТЫ. Драйвер прав: 0x11:0x18 = заряд батареи.');
      console.log('  Запись в NOTES §159 «session counter» — НЕВЕРНА, исправить.');
    } else {
      console.log('\n  Значения вне 0..100 — это НЕ проценты батареи.');
    }
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});

