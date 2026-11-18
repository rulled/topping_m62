/**
 * ПРОВЕРКА НА КАРТЕ: mutes и loopback-гейны.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Теория из драйвера ядра (см. `research/CONTROLS-MAP.md`):
 *   1. Mute входа: 0x21:0x05, 1 = заглушено. Прочитать обратно
 *      можно ли?
 *   2. Loopback-гейн 0x51/0x52:0x03, Q25 из таблицы.
 *      Прочитать обратно? (Драйвер говорит «never reported».)
 *   3. Селектор 0x64:0x02 — пишется, но не читается.
 *
 * Главное, что надо выяснить: **что из этого карта отдаёт назад**.
 * Драйвер утверждает, что селекторы и loopback-гейны не отдаются
 * никогда, а mute выходов — отдаётся (0x64:0x04 в announce).
 *
 * ═══ МЕТОД ═══
 *
 * Пишем -> закрываем сессию -> открываем НОВУЮ -> читаем.
 * Только так можно отличить «применено» от «кеш».
 * (Тот же метод, что доказал работу EQ: `prove-eq-in2-live.js`.)
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Глушим наушники перед началом. Loopback ставим в его же исходное
 * значение. Mute входов НЕ трогаем на включение, только проверяем
 * текущее состояние и возвращаем mute (тишина — безопасно).
 *
 * Запуск: node src/tools/prove-mutes-loopback-live.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';
import {
  LOOPBACK_RETURNS,
  MUTE_CONTROLS,
  buildLoopbackGainFrames,
  buildMuteFrames,
  lbStepToDb,
} from '../mutes-loopback.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

async function openFresh(waitMs = 8000) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(waitMs);
  return t;
}

/** Записать кадры и подождать фиксации. */
async function writeAndSettle(t, frames) {
  t.writeFrames(frames, { updateCache: false });
  // Не EQ, но дадим карте время записать
  await sleep(2500);
}

async function main() {
  console.log('='.repeat(72));
  console.log('MUTES И LOOPBACK НА КАРТЕ');
  console.log('='.repeat(72));

  // ─── исходное состояние ───
  const s0 = await openFresh();

  const jack = s0.get(0x64, 0x06);
  const hpMute = s0.get(0x64, 0x04);
  console.log(`\nнаушники: jack=${jack} mute=${hpMute}`);

  // Глушим наушники
  if (jack === 1 && hpMute !== 1) {
    const hpCtl = MUTE_CONTROLS.find((c) => c.id === 'hp');
    s0.writeFrames(buildMuteFrames(hpCtl, false));
    await sleep(1500);
    console.log(`  заглушено: mute=${s0.get(0x64, 0x04)}`);
  }

  // ─── что читается СЕЙЧАС ───
  console.log('\n' + '-'.repeat(72));
  console.log('1. ЧТО КАРТА ОТДАЁТ СЕЙЧАС (без записи)');
  console.log('-'.repeat(72));

  for (const c of MUTE_CONTROLS) {
    const v = s0.get(c.target, c.prop);
    console.log(`  mute ${c.name.padEnd(10)} 0x${c.target.toString(16)}:0x${c.prop.toString(16)} = `
      + `${v === null ? 'НЕТ' : v}${v === null ? '' : v === 1 ? ' (mute)' : ' (звук)'}`);
  }

  console.log('');
  for (const r of LOOPBACK_RETURNS) {
    const v = s0.get(r.gainTarget, 0x03);
    console.log(`  гейн ${r.name.padEnd(14)} 0x${r.gainTarget.toString(16)}:0x03 = `
      + `${v === null ? 'НЕТ' : v}`);
  }

  console.log('');
  for (const sel of [['HP', 0x64], ['OTG', 0x62], ['LB 1/2', 0x51], ['LB 3/4', 0x53]]) {
    const v = s0.get(sel[1], 0x02);
    console.log(`  селектор ${sel[0].padEnd(8)} 0x${sel[1].toString(16)}:0x02 = `
      + `${v === null ? 'НЕТ' : v}`);
  }

  const loopback = LOOPBACK_RETURNS[0];
  const lbBefore = s0.get(loopback.gainTarget, 0x03);
  s0.close();
  await sleep(2000);

  // ─── тест 1: MUTE выхода (карта должна отдавать) ───
  console.log('\n' + '-'.repeat(72));
  console.log('2. MUTE ВЫХОДА: пишем и читаем новой сессией');
  console.log('-'.repeat(72));

  const hpCtl = MUTE_CONTROLS.find((c) => c.id === 'hp');
  const results = [];

  const w1 = await openFresh();
  await writeAndSettle(w1, buildMuteFrames(hpCtl, false)); // mute on
  w1.close();
  await sleep(2000);

  const r1 = await openFresh();
  const after = r1.get(0x64, 0x04);
  r1.close();
  await sleep(1500);

  const muteApplied = after === 1;
  console.log(`  записали mute=1, читается ${after}  ${muteApplied ? 'ПРИМЕНЕНО' : 'не применено'}`);
  results.push({ name: 'mute HP читается', ok: muteApplied });

  // ─── тест 2: LOOPBACK-ГЕЙН ───
  console.log('\n' + '-'.repeat(72));
  console.log('3. LOOPBACK-ГЕЙН: пишем и читаем новой сессией');
  console.log('-'.repeat(72));

  const targetStep = 90; // 0 дБ
  const w2 = await openFresh();
  await writeAndSettle(w2, buildLoopbackGainFrames(loopback, targetStep));
  w2.close();
  await sleep(2000);

  const r2 = await openFresh();
  const lbAfter = r2.get(loopback.gainTarget, 0x03);
  const lbAfterPair = r2.get(loopback.gainPair, 0x03);
  r2.close();
  await sleep(1500);

  console.log(`  писали шаг ${targetStep} (${lbStepToDb(targetStep)} дБ)`);
  console.log(`  читается: 0x${loopback.gainTarget.toString(16)}=${lbAfter} `
    + `0x${loopback.gainPair.toString(16)}=${lbAfterPair}`);
  const lbReadable = lbAfter === 33554432;
  console.log(`  ${lbReadable ? 'ПРИМЕНЕНО И ЧИТАЕТСЯ' : 'не читается (или не применено)'}`);
  results.push({ name: 'loopback-гейн читается', ok: lbReadable });

  // ─── тест 3: СЕЛЕКТОР ───
  console.log('\n' + '-'.repeat(72));
  console.log('4. СЕЛЕКТОР: пишем и читаем новой сессией');
  console.log('-'.repeat(72));

  const w3 = await openFresh();
  await writeAndSettle(w3, [{ target: 0x64, prop: 0x02, value: 12 }]); // Playback 1/2
  w3.close();
  await sleep(2000);

  const r3 = await openFresh();
  const selAfter = r3.get(0x64, 0x02);
  r3.close();
  await sleep(1500);

  console.log(`  писали 12 (Playback 1/2), читается ${selAfter}`);
  const selReadable = selAfter === 12;
  console.log(`  ${selReadable ? 'ЧИТАЕТСЯ' : 'не читается (ожидаемо по драйверу)'}`);
  results.push({ name: 'селектор читается', ok: selReadable });

  // ─── откат ───
  console.log('\n' + '-'.repeat(72));
  console.log('ОТКАТ');
  console.log('-'.repeat(72));

  const rb = await openFresh();
  if (lbBefore !== null) {
    const frames = [
      { target: loopback.gainTarget, prop: 0x03, value: lbBefore },
      { target: loopback.gainPair, prop: 0x03, value: lbBefore },
    ];
    rb.writeFrames(frames);
    console.log(`  loopback возвращён в ${lbBefore}`);
  }
  await sleep(2000);
  rb.close();

  // ─── итог ───
  console.log('\n' + '='.repeat(72));
  console.log('ИТОГ');
  console.log('='.repeat(72));
  for (const r of results) {
    console.log(`  ${r.name.padEnd(26)} ${r.ok ? 'ЧИТАЕТСЯ' : 'НЕ читается'}`);
  }

  console.log(`
  ЧТО ЭТО ЗНАЧИТ

  Драйвер утверждает: селекторы и loopback-гейны «never reported»,
  а mute выходов — наоборот, приходит в announce (0x64:0x04).
  Проверка выше показывает, так ли это на нашей карте.
`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
