/**
 * ПРОВЕРКА НА КАРТЕ: EQ НАУШНИКОВ (0xa1..0xaa).
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Фаза 2 плана (`docs/WEB-CLIENT.md` §11). Блоки 0xa1..0xaa — это
 * 10 полос × 2 канала (L: свойства 0x01..0x05, R: 0x06..0x0a).
 * Существуют ТОЛЬКО в режиме Prof.
 *
 * До сих пор запись в 0xa1 проверялась разово (`send(0xa1, 0x03, 30)`
 * по заметкам). Здесь проверяется вся раскладка, которой пользуется
 * страница:
 *
 *   полоса 1 L gain    -> 0xa1:0x03
 *   полоса 1 R gain    -> 0xa1:0x08   (смещение канала +5)
 *   полоса 10 L gain   -> 0xaa:0x03
 *   полоса 10 R gain   -> 0xaa:0x08
 *   полоса 3 L тип     -> 0xa3:0x02
 *   полоса 3 R тип     -> 0xa3:0x07
 *   полоса 5 L частота -> 0xa5:0x04
 *   полоса 7 R Q       -> 0xa7:0x0a
 *
 * ═══ МЕТОД ═══
 *
 * Тот же, что у EQ входов (доказан в `prove-eq-in2-live`):
 *   1. `writeEqWithCommit` — пишет, держит сессию, ждёт settle;
 *   2. закрыть сессию, открыть НОВУЮ (`readFresh`);
 *   3. сравнить.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся перед началом, все значения откатываются.
 * Gain не больше 3 дБ. Частота/тип/Q при выключенной полосе на звук
 * не влияют — но полосы мы всё равно не включаем.
 *
 * Запуск: node src/tools/prove-eq-hp-live.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';
import { buildBandFrames, EQ_HP_BANDS, readAllBands } from '../eq-hp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

/** Режимы (0x11:0x1d). */
const MODE_LIVE = 2;
const MODE_PROF = 3;

async function openFresh(waitMs = 9000) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(waitMs); // Prof: 0xa1..0xaa приходят на ~7.3 с
  return t;
}

/** Есть ли в снимке блоки EQ наушников. */
function hpPresent(snap) {
  return Object.keys(snap).some((k) => {
    const [a] = k.split(':');
    const tt = /[a-f]/i.test(a) ? parseInt(a, 16) : Number(a);
    return Number.isFinite(tt) && tt >= 0xa1 && tt <= 0xaa;
  });
}

/**
 * Переключить режим.
 *
 * ═══ ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ОПЕРАЦИЯ ═══
 *
 * `0x11:0x1d` ПЕРЕЗАГРУЖАЕТ карту. HID-соединение при этом рвётся —
 * отправка кадра «успевает», а следующий write уже падает. Поэтому
 * после отправки мы закрываем соединение и ЖДЁМ, пока устройство
 * снова появится в системе.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * В момент перезагрузки звука нет вообще. Наушники к этому моменту
 * уже заглушены или отключены (проверяется вызывающим кодом).
 */
async function switchMode(mode) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(1500);
  try {
    t.send(0x11, 0x1d, mode, true);
  } catch {
    /* ожидаемо: карта уходит на перезагрузку */
  }
  await sleep(1500);
  try {
    t.close();
  } catch {
    /* уже */
  }
}

/**
 * Дождаться, пока карта поднимется после перезагрузки.
 * @returns {Promise<boolean>}
 */
async function waitForDevice(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(1500);
    try {
      const probe = await openFresh(0);
      probe.close();
      return true;
    } catch {
      /* ещё не поднялась */
    }
  }
  return false;
}

async function main() {
  console.log('='.repeat(70));
  console.log('EQ НАУШНИКОВ (0xa1..0xaa) — ПРОВЕРКА НА КАРТЕ');
  console.log('='.repeat(70));

  // ─── исходное состояние и безопасность ───
  const s0 = await openFresh();
  const snap0 = s0.snapshot();

  const jack = s0.get(0x64, 0x06);
  const mute = s0.get(0x64, 0x04);
  console.log(`\nнаушники: jack=${jack} mute=${mute}`);

  const wasProf = hpPresent(snap0);

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
  s0.close();
  await sleep(1500);

  // ─── при необходимости переключаемся в Prof ───
  let switched = false;
  if (!wasProf) {
    console.log('\n' + '-'.repeat(70));
    console.log('карта не в Prof — переключаю (0x11:0x1d = 3)');
    console.log('ВНИМАНИЕ: карта перезагрузится, звука не будет ~8 с');
    console.log('-'.repeat(70));

    await switchMode(MODE_PROF);
    const up = await waitForDevice(45000);
    if (!up) {
      console.log('  ОСТАНОВ: карта не вернулась после перезагрузки');
      process.exit(1);
    }
    switched = true;
    console.log('  карта поднялась, жду блоки EQ наушников…');
    await sleep(4000);
  }

  // ─── повторное чтение уже в Prof ───
  const s1 = await openFresh(11000);
  const snap1 = s1.snapshot();

  if (!hpPresent(snap1)) {
    console.log('\n⚠ блоков 0xa1..0xaa нет даже после переключения в Prof.');
    console.log('  Проверка НЕ выполнена. Возможно, режим не переключился.');
    s1.close();
    if (switched) {
      console.log('\nвозвращаю Live…');
      await switchMode(MODE_LIVE);
      await waitForDevice(45000);
    }
    process.exit(2);
  }

  const before = readAllBands(snap1);
  const addrCount = Object.keys(snap1).filter((k) => {
    const [a] = k.split(':');
    const tt = /[a-f]/i.test(a) ? parseInt(a, 16) : Number(a);
    return tt >= 0xa1 && tt <= 0xaa;
  }).length;

  console.log(`\nполос получено: ${before.filter((b) => b.l.gain !== undefined).length} из ${EQ_HP_BANDS}`);
  console.log(`адресов в 0xa1..0xaa: ${addrCount}`);

  const show = (b) => `L en=${b.l.enable} type=${b.l.type} gain=${b.l.gain} f=${b.l.freq} q=${b.l.q} | `
    + `R en=${b.r.enable} type=${b.r.type} gain=${b.r.gain} f=${b.r.freq} q=${b.r.q}`;
  console.log(`  полоса 1:  ${show(before[0])}`);
  console.log(`  полоса 10: ${show(before[9])}`);

  s1.close();
  await sleep(2000);

  // ─── записи ───
  const results = [];

  /**
   * Записать и подтвердить новой сессией.
   * @param {string} label
   * @param {Array} frames
   * @param {(bands:Array)=>any} read как прочитать из свежих полос
   * @param {any} expected
   */
  const trial = async (label, frames, read, expected) => {
    console.log(`\n${label}`);
    const w = await openFresh();
    await w.writeEqWithCommit(frames, { holdMs: 2500 });
    w.close();
    await sleep(2000);

    const r = await openFresh();
    const got = read(readAllBands(r.snapshot()));
    r.close();
    await sleep(1500);

    const ok = got === expected;
    console.log(`  читается ${got}, хотели ${expected}  ${ok ? 'ПРИМЕНЕНО' : 'не применено'}`);
    results.push({ label, ok, got, expected });
    return ok;
  };

  await trial(
    'полоса 1 L gain=3',
    buildBandFrames(1, { l: { gain: 3 } }),
    (b) => b[0].l.gain,
    3,
  );
  await trial(
    'полоса 1 R gain=2',
    buildBandFrames(1, { r: { gain: 2 } }),
    (b) => b[0].r.gain,
    2,
  );
  await trial(
    'полоса 10 L gain=-3',
    buildBandFrames(10, { l: { gain: -3 } }),
    (b) => b[9].l.gain,
    -3,
  );
  await trial(
    'полоса 10 R gain=1',
    buildBandFrames(10, { r: { gain: 1 } }),
    (b) => b[9].r.gain,
    1,
  );
  await trial(
    'полоса 3 L тип=lowpass',
    buildBandFrames(3, { l: { type: 2 } }),
    (b) => b[2].l.type,
    2,
  );
  await trial(
    'полоса 3 R тип=highpass',
    buildBandFrames(3, { r: { type: 3 } }),
    (b) => b[2].r.type,
    3,
  );
  await trial(
    'полоса 5 L частота=1000',
    buildBandFrames(5, { l: { freq: 1000 } }),
    (b) => b[4].l.freq,
    1000,
  );
  await trial(
    'полоса 7 R Q=1.5 (15000)',
    buildBandFrames(7, { r: { q: 15000 } }),
    (b) => b[6].r.q,
    15000,
  );

  // ─── откат ───
  console.log('\n' + '-'.repeat(70));
  console.log('ОТКАТ');
  console.log('-'.repeat(70));

  const rollback = [];
  for (let i = 0; i < EQ_HP_BANDS; i += 1) {
    const b = before[i];
    const band = i + 1;
    const l = {};
    const r = {};
    for (const f of ['enable', 'type', 'gain', 'freq', 'q']) {
      if (b.l[f] !== undefined) l[f] = b.l[f];
      if (b.r[f] !== undefined) r[f] = b.r[f];
    }
    if (Object.keys(l).length || Object.keys(r).length) {
      rollback.push(...buildBandFrames(band, { l, r }));
    }
  }

  if (rollback.length) {
    console.log(`  возвращаю ${rollback.length} кадров (все 10 полос, оба канала)`);
    const rb = await openFresh();
    await rb.writeEqWithCommit(rollback, { holdMs: 3000 });
    rb.close();
    await sleep(2500);
  }

  // ─── контроль отката ───
  const fin = await openFresh();
  const after = readAllBands(fin.snapshot());
  let mismatches = 0;
  for (let i = 0; i < EQ_HP_BANDS; i += 1) {
    for (const ch of ['l', 'r']) {
      for (const f of ['enable', 'type', 'gain', 'freq', 'q']) {
        const want = before[i][ch][f];
        const got = after[i][ch][f];
        if (want !== undefined && got !== undefined && want !== got) {
          mismatches += 1;
          console.log(`  расхождение полоса ${i + 1} ${ch}.${f}: было ${want}, стало ${got}`);
        }
      }
    }
  }
  console.log(`  расхождений после отката: ${mismatches}`);
  fin.close();

  // ─── вердикт ───
  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(28)} ${r.ok ? 'РАБОТАЕТ' : 'нет'}  (${r.got})`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n  пройдено: ${okCount} из ${results.length}`);

  if (okCount === results.length) {
    console.log('\n  ФАЗА 2 ПОДТВЕРЖДЕНА НА КАРТЕ:');
    console.log('  EQ наушников пишется, оба канала и все свойства.');
  } else {
    console.log('\n  часть свойств не принята — смотрим таблицу выше');
  }

  // ─── вернуть исходный режим ───
  if (switched) {
    console.log('\n' + '-'.repeat(70));
    console.log(`возвращаю режим (0x11:0x1d = ${MODE_LIVE})`);
    console.log('-'.repeat(70));
    await switchMode(MODE_LIVE);
    const back = await waitForDevice(45000);
    console.log(`  карта поднялась: ${back}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
