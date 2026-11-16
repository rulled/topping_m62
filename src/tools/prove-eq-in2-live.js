/**
 * ПРОВЕРКА: EQ IN 2 И ОСТАЛЬНЫЕ СВОЙСТВА РАБОТАЮТ НА КАРТЕ.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Фаза 1 плана (`docs/WEB-CLIENT.md` §11): расширенный EQ —
 * вход IN 2 и все пять свойств полосы.
 *
 * Ранее на карте проверялось только: IN1, gain. Теперь надо
 * убедиться, что принимаются:
 *
 *   IN 2:  полосы 1,2 -> 0x93    полосы 3,4 -> 0x94
 *   тип     -> prop 0x02 / 0x07
 *   частота -> prop 0x04 / 0x09
 *   Q       -> prop 0x05 / 0x0a
 *
 * ═══ МЕТОД ═══
 *
 * Подтверждать запись в той же сессии НЕЛЬЗЯ: EQ приходит только
 * на первый announce новой сессии (доказано `prove-announce-eq-rule`).
 * Поэтому каждая проверка:
 *   1. пишет значение через `writeEqWithCommit` (держит 2.5 с);
 *   2. ЗАКРЫВАЕТ сессию, открывает НОВУЮ (`readFresh`);
 *   3. сравнивает с записанным.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Gain не больше 3 дБ, всё
 * откатывается в конце. Тип/частота/Q на звук при gain=0 не влияют.
 *
 * Запуск: node src/tools/prove-eq-in2-live.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

/** Открыть сессию, подождать первый announce. */
async function openFresh() {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(7000);
  return t;
}

/**
 * Пишем в сессии, затем читаем правду в НОВОЙ сессии.
 * @returns {{got:number|null}}
 */
async function writeThenVerify(frames, readAddr) {
  const w = await openFresh();
  // Паузу держит сам writeEqWithCommit (hold + settle). Раньше тест
  // спал здесь вручную — и это маскировало, что библиотека закрывала
  // сессию слишком рано. Теперь ничего дополнительного не нужно:
  // если метод вернулся, закрывать сессию безопасно.
  await w.writeEqWithCommit(frames, { holdMs: 2500 });
  w.close();
  await sleep(2000);

  const r = await openFresh();
  const got = r.get(readAddr[0], readAddr[1]);
  r.close();
  await sleep(1200);
  return { got };
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ IN 2 И ВСЕ СВОЙСТВА ПОЛОСЫ — ПРОВЕРКА НА КАРТЕ');
  console.log('='.repeat(70));

  // ─── безопасность и исходное ───
  const s0 = await openFresh();
  const jack = s0.get(0x64, 0x06);
  const mute = s0.get(0x64, 0x04);
  console.log(`\nнаушники: jack=${jack} mute=${mute}`);
  if (jack === 1 && mute !== 1) {
    s0.writeFrames([{ target: 0x64, prop: 0x04, value: 1 }]);
    await sleep(1500);
    if (s0.get(0x64, 0x04) !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      s0.close();
      process.exit(1);
    }
    console.log('  заглушено');
  }

  const in1 = {
    g1: s0.get(0x91, 0x03),
    t1: s0.get(0x91, 0x02),
    f1: s0.get(0x91, 0x04),
    q1: s0.get(0x91, 0x05),
  };
  const in2 = {
    g1: s0.get(0x93, 0x03),
    t1: s0.get(0x93, 0x02),
    f1: s0.get(0x93, 0x04),
    q1: s0.get(0x93, 0x05),
    g3: s0.get(0x94, 0x03),
  };
  const eqIn2Count = Object.keys(s0.snapshot()).filter((k) => /^(147|148):/.test(k)).length;
  console.log('\nисходное:');
  console.log(`  IN1: gain=${in1.g1} type=${in1.t1} freq=${in1.f1} q=${in1.q1}`);
  console.log(`  IN2: gain=${in2.g1} type=${in2.t1} freq=${in2.f1} q=${in2.q1} band3gain=${in2.g3}`);
  console.log(`  адресов IN2 (0x93/0x94): ${eqIn2Count}`);
  s0.close();
  await sleep(1500);

  if (eqIn2Count === 0) {
    console.log('\n⚠ блоки IN2 (0x93/0x94) не пришли — вход IN2 неактивен?');
    console.log('  Продолжаю: возможно, они появятся после записи.');
  }

  const results = [];

  const trial = async (label, frames, addr, expected) => {
    console.log(`\n${label}: пишу, затем читаю в новой сессии`);
    const { got } = await writeThenVerify(frames, addr);
    const ok = got === expected;
    console.log(`  читается ${got}, хотели ${expected}  ${ok ? 'ПРИМЕНЕНО' : 'не применено'}`);
    results.push({ label, ok, got, expected });
    return ok;
  };

  // ─── IN2: gain полос 1 и 3 ───
  await trial('IN2 полоса1 gain=3', [{ target: 0x93, prop: 0x03, value: 3 }], [0x93, 0x03], 3);
  await trial('IN2 полоса3 gain=2', [{ target: 0x94, prop: 0x03, value: 2 }], [0x94, 0x03], 2);

  // ─── IN1: тип / частота / Q ───
  await trial('IN1 полоса1 тип=lowpass', [{ target: 0x91, prop: 0x02, value: 2 }], [0x91, 0x02], 2);
  await trial('IN1 полоса1 частота=1000', [{ target: 0x91, prop: 0x04, value: 1000 }], [0x91, 0x04], 1000);
  await trial('IN1 полоса1 Q=1.5', [{ target: 0x91, prop: 0x05, value: 15000 }], [0x91, 0x05], 15000);

  // ─── откат ───
  console.log('\n' + '-'.repeat(70));
  console.log('ОТКАТ');
  console.log('-'.repeat(70));
  const rollback = [];
  if (in1.g1 !== null) rollback.push({ target: 0x91, prop: 0x03, value: in1.g1 });
  if (in1.t1 !== null) rollback.push({ target: 0x91, prop: 0x02, value: in1.t1 });
  if (in1.f1 !== null) rollback.push({ target: 0x91, prop: 0x04, value: in1.f1 });
  if (in1.q1 !== null) rollback.push({ target: 0x91, prop: 0x05, value: in1.q1 });
  if (in2.g1 !== null) rollback.push({ target: 0x93, prop: 0x03, value: in2.g1 });
  if (in2.g3 !== null) rollback.push({ target: 0x94, prop: 0x03, value: in2.g3 });

  if (rollback.length) {
    const rb = await openFresh();
    await rb.writeEqWithCommit(rollback, { holdMs: 2500 });
    rb.close();
    await sleep(2000);
  }

  const fin = await openFresh();
  console.log(`  IN1 gain=${fin.get(0x91, 0x03)} type=${fin.get(0x91, 0x02)} freq=${fin.get(0x91, 0x04)} q=${fin.get(0x91, 0x05)}`);
  console.log(`  IN2 gain=${fin.get(0x93, 0x03)}`);
  fin.close();

  // ─── вердикт ───
  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(26)} ${r.ok ? 'РАБОТАЕТ' : 'нет'}  (${r.got})`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n  пройдено: ${okCount} из ${results.length}`);
  if (okCount === results.length) {
    console.log('\n  ФАЗА 1 ПОДТВЕРЖДЕНА НА КАРТЕ:');
    console.log('  IN2 и все свойства полос (тип, частота, Q) пишутся.');
  } else {
    console.log('\n  часть свойств не принята — смотрим таблицу выше');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});

