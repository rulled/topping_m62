/**
 * СНЯТЬ ДАМП В PROF И ВЕРНУТЬ LIVE.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Проверяет, что наушники заглушены/отключены.
 * 2. Переключает в Prof (0x11:0x1d = 3) — карта перезагружается.
 * 3. Ждёт полный дамп 14 с, сохраняет в JSON.
 * 4. Возвращает Live (0x11:0x1d = 2).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * В момент перезагрузки звука нет вообще. Наушники глушатся ДО
 * переключения. В конце режим возвращается в Live.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Сверить Live и Prof: наши заметки говорят, что наборы тегов
 * различаются вдвое, а UCM-профиль — что layout идентичен.
 * Надо получить оба дампа и сравнить.
 *
 * Запуск: node src/tools/probe-prof-dump.js
 */

import { writeFileSync } from 'node:fs';

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

const MODE_LIVE = 2;
const MODE_PROF = 3;

async function openFresh(waitMs = 8000) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(waitMs);
  return t;
}

async function switchMode(mode) {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(1500);
  try {
    t.send(0x11, 0x1d, mode);
  } catch {
    /* ожидаемо: карта уходит на перезагрузку */
  }
  await sleep(1500);
  try { t.close(); } catch { /* уже */ }
}

async function waitForDevice(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(1500);
    try {
      const p = await openFresh(0);
      p.close();
      return true;
    } catch {
      /* ещё не поднялась */
    }
  }
  return false;
}

async function main() {
  console.log('='.repeat(70));
  console.log('СНИМОК В PROF');
  console.log('='.repeat(70));

  // ─── безопасность ───
  const s0 = await openFresh();
  const jack = s0.get(0x64, 0x06);
  const mute = s0.get(0x64, 0x04);
  console.log(`\nнаушники: jack=${jack} mute=${mute}`);

  if (jack === 1 && mute !== 1) {
    s0.writeFrames([{ target: 0x64, prop: 0x04, value: 1 },
      { target: 0x63, prop: 0x04, value: 1 }]);
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

  // ─── в Prof ───
  console.log('\n' + '-'.repeat(70));
  console.log('переключаю в Prof (0x11:0x1d = 3), карта перезагрузится');
  console.log('-'.repeat(70));

  await switchMode(MODE_PROF);
  const up = await waitForDevice(45000);
  if (!up) {
    console.log('  ОСТАНОВ: карта не вернулась');
    process.exit(1);
  }
  console.log('  карта поднялась, жду полный дамп…');
  await sleep(3000);

  // ─── дамп ───
  const sp = await openFresh(14000);
  const snap = sp.snapshot();
  const families = [...new Set(Object.keys(snap).map((k) => Number(String(k).split(':')[0])))].sort((x, y) => x - y);
  sp.close();

  const hasEqHp = families.some((f) => f >= 0xa1 && f <= 0xaa);
  console.log(`\n  режим по семействам: ${hasEqHp ? 'Prof' : 'НЕ Prof'}`);
  console.log(`  адресов: ${Object.keys(snap).length}`);
  console.log(`  семейств: ${families.length}`);
  console.log(`  ${families.map((f) => '0x' + f.toString(16)).join(' ')}`);

  writeFileSync('research/mode-prof-full.json', JSON.stringify({
    snap, families, mode: hasEqHp ? 'Prof' : 'unknown', at: new Date().toISOString(),
  }, null, 2), 'utf8');
  console.log('\n  записано в research/mode-prof-full.json');

  // ─── вернуть Live ───
  console.log('\n' + '-'.repeat(70));
  console.log('возвращаю Live (0x11:0x1d = 2)');
  console.log('-'.repeat(70));

  await sleep(2000);
  await switchMode(MODE_LIVE);
  const back = await waitForDevice(45000);
  console.log(`  карта поднялась: ${back}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
