/**
 * СВЕРКА Live vs Prof: различаются ли наборы тегов?
 *
 * ═══ ПРОТИВОРЕЧИЕ, КОТОРОЕ НАДО РЕШИТЬ ═══
 *
 * Наши заметки (NOTES §127, §84) говорят:
 *   Mobile ~95 тегов, Live ~91-102, Prof 170-202.
 *   «Только Prof имеет 0xa1..0xaa (EQ наушников)».
 *
 * Но UCM-профиль (PR #826, см. `research/UCM-ARCHITECTURE.md`)
 * утверждает другое:
 *
 *   «Live Streaming and Pro Audio have identical channel layouts
 *    and on USB differ only in the rates they offer, 44.1 and 48 kHz
 *    against those plus 88.2 and 96 kHz.»
 *
 * То есть по UCM layout ИДЕНТИЧЕН, а мы видели разницу в 2 раза.
 *
 * Возможные объяснения:
 *   1. наши дампы в Live были НЕПОЛНЫМИ (не дождались announce);
 *   2. Live действительно беднее по HID-тегам, а UCM говорит только
 *      про аудио-каналы (UAC), а не про vendor-протокол;
 *   3. мы путали режимы.
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
 *
 * Снимает ПОЛНЫЙ дамп в текущем режиме, сохраняет в JSON, показывает
 * семейства. Запускать дважды: в Live и в Prof, потом сравнить.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Только чтение. Режим НЕ переключает (это перезагрузка карты).
 *
 * Запуск:
 *   node src/tools/probe-mode-dump.js --out live.json
 *   (переключить режим в MCC на Prof)
 *   node src/tools/probe-mode-dump.js --out prof.json
 *   node src/tools/probe-mode-dump.js --compare live.json prof.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

/** Сколько ждать полный дамп. */
const DUMP_WAIT_MS = 14000;

async function dumpMode() {
  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });
  await t.open();
  await sleep(DUMP_WAIT_MS);

  const snap = t.snapshot();
  const stats = { ...t.stats };

  // Определяем режим по bcdDevice нельзя (это USB, не HID), поэтому
  // по семействам — как договорились раньше.
  const families = [...new Set(Object.keys(snap).map((k) => Number(String(k).split(':')[0])))].sort((x, y) => x - y);
  const has = (t2) => families.includes(t2);

  let mode = 'unknown';
  if (families.some((f) => f >= 0xa1 && f <= 0xaa)) mode = 'Prof';
  else if (has(0x44)) mode = 'Live';
  else if (has(0x43)) mode = 'Mobile';

  t.close();
  return { snap, stats, families, mode, at: new Date().toISOString() };
}

function compare(f1, f2) {
  const a = JSON.parse(readFileSync(f1, 'utf8'));
  const b = JSON.parse(readFileSync(f2, 'utf8'));

  console.log('='.repeat(74));
  console.log('СВЕРКА РЕЖИМОВ');
  console.log('='.repeat(74));
  console.log(`\n  ${f1}: режим ${a.mode}, адресов ${Object.keys(a.snap).length}`);
  console.log(`  ${f2}: режим ${b.mode}, адресов ${Object.keys(b.snap).length}`);

  const keysA = new Set(Object.keys(a.snap));
  const keysB = new Set(Object.keys(b.snap));

  const onlyA = [...keysA].filter((k) => !keysB.has(k)).sort();
  const onlyB = [...keysB].filter((k) => !keysA.has(k)).sort();
  const both = [...keysA].filter((k) => keysB.has(k)).sort();

  console.log(`\n  общих адресов:      ${both.length}`);
  console.log(`  только в ${a.mode}:  ${onlyA.length}`);
  console.log(`  только в ${b.mode}:  ${onlyB.length}`);

  const fam = (keys) => {
    const m = new Map();
    for (const k of keys) {
      const tt = Number(String(k).split(':')[0]);
      m.set(tt, (m.get(tt) ?? 0) + 1);
    }
    return [...m].sort((x, y) => x[0] - y[0])
      .map(([tt, n]) => `0x${tt.toString(16).padStart(2, '0')}:${n}`).join('  ');
  };

  console.log(`\n  семейства в ${a.mode}:`);
  console.log(`    ${fam(keysA)}`);
  console.log(`\n  семейства в ${b.mode}:`);
  console.log(`    ${fam(keysB)}`);

  if (onlyA.length) {
    console.log(`\n  ТОЛЬКО В ${a.mode} (первые 40):`);
    console.log(`    ${onlyA.slice(0, 40).join(', ')}`);
    if (onlyA.length > 40) console.log(`    ... ещё ${onlyA.length - 40}`);
  }
  if (onlyB.length) {
    console.log(`\n  ТОЛЬКО В ${b.mode} (первые 40):`);
    console.log(`    ${onlyB.slice(0, 40).join(', ')}`);
    if (onlyB.length > 40) console.log(`    ... ещё ${onlyB.length - 40}`);
  }

  // ─── значения, которые отличаются ───
  const diffVals = both.filter((k) => a.snap[k] !== b.snap[k]);
  console.log(`\n  общих адресов с РАЗНЫМИ значениями: ${diffVals.length}`);
  if (diffVals.length) {
    console.log('    (первые 20 — возможно, это метры, они всегда разные)');
    for (const k of diffVals.slice(0, 20)) {
      console.log(`    ${k}: ${a.snap[k]} -> ${b.snap[k]}`);
    }
  }

  // ─── вывод ───
  console.log('\n' + '='.repeat(74));
  console.log('ВЫВОД');
  console.log('='.repeat(74));

  const eqHpA = a.families.some((f) => f >= 0xa1 && f <= 0xaa);
  const eqHpB = b.families.some((f) => f >= 0xa1 && f <= 0xaa);

  console.log(`\n  EQ наушников (0xa1..0xaa): в ${a.mode} — ${eqHpA ? 'ЕСТЬ' : 'нет'}, `
    + `в ${b.mode} — ${eqHpB ? 'ЕСТЬ' : 'нет'}`);

  if (onlyA.length === 0 && onlyB.length === 0) {
    console.log('\n  Наборы адресов ИДЕНТИЧНЫ — совпадает с утверждением UCM.');
  } else {
    console.log(`
  Наборы РАЗЛИЧАЮТСЯ на ${onlyA.length + onlyB.length} адресов.
  Значит UCM говорит только про АУДИО-каналы (UAC), а vendor-протокол
  (HID) в разных режимах отдаёт разное. Наше прежнее наблюдение верно,
  противоречия нет — просто UCM про другое.
`);
  }
}

async function main() {
  const iOut = process.argv.indexOf('--out');
  const iCmp = process.argv.indexOf('--compare');

  if (iCmp >= 0) {
    const f1 = process.argv[iCmp + 1];
    const f2 = process.argv[iCmp + 2];
    if (!f1 || !f2) {
      console.error('нужно: --compare file1.json file2.json');
      process.exit(1);
    }
    compare(f1, f2);
    return;
  }

  const out = iOut >= 0 ? process.argv[iOut + 1] : 'mode-dump.json';

  console.log('='.repeat(74));
  console.log('СНИМОК РЕЖИМА');
  console.log('='.repeat(74));
  console.log(`\nжду полный дамп ${DUMP_WAIT_MS / 1000} с…`);

  const r = await dumpMode();

  console.log(`\n  режим (по семействам): ${r.mode}`);
  console.log(`  адресов: ${Object.keys(r.snap).length}`);
  console.log(`  семейств: ${r.families.length}`);
  console.log(`  ${r.families.map((f) => '0x' + f.toString(16)).join(' ')}`);

  writeFileSync(out, JSON.stringify(r, null, 2), 'utf8');
  console.log(`\n  записано в ${out}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
