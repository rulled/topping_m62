/**
 * СИГНАТУРЫ РЕЖИМОВ: чем Live отличается от Mobile и Prof.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Сейчас устройство в Live, но `state-check.js` определил его как
 * Mobile: в потоке НЕТ ни loopback (0x51..0x58), ни микшера (0x31..0x3c),
 * хотя в Live они должны быть.
 *
 * Два объяснения:
 *   1. определение режима в коде неверное;
 *   2. в Live микшер и loopback приходят ТОЛЬКО в bulk push при старте
 *      MCC, а не в обычном ANNOUNCE-дампе.
 *
 * Второе подтверждается §126: микшер никогда не приходит в IN,
 * loopback тоже (IN=0 во всех захватах). Значит их отсутствие в
 * дампе — НЕ признак режима.
 *
 * Скрипт сравнивает сохранённые дампы по семействам и находит
 * устойчивые признаки.
 *
 * Запуск: node src/tools/mode-signatures.js
 */

import { readFileSync, existsSync } from 'node:fs';

const FILES = [
  ['Mobile', 'research/mode-mobile.json'],
  ['Live', 'research/mode-live.json'],
  ['Prof (slow)', 'research/mode-prof-slow.json'],
  ['Prof', 'research/mode-prof.json'],
  ['Prof2', 'research/mode-prof2.json'],
];

/**
 * TT из ключа дампа.
 *
 * ВАЖНО: файлы `research/mode-*.json` пишет `dump-mode.js`, и он
 * формирует ключи ВСЕГДА в hex без префикса: `hex2(tt) + ':' + hex2(pp)`.
 * Поэтому здесь разбираем строго как hex.
 *
 * (В других местах проекта `transport.snapshot()` пишет decimal —
 * это разные форматы, и путать их нельзя. Ровно на этой путанице
 * раньше сломалось определение режима.)
 */
function famOf(key) {
  const a = key.includes(':') ? key.split(':')[0] : key;
  const n = parseInt(a, 16);
  return Number.isFinite(n) ? n : null;
}

const rows = [];

for (const [label, path] of FILES) {
  if (!existsSync(path)) {
    rows.push({ label, missing: true });
    continue;
  }
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const keys = Object.keys(j.tags ?? {});
  const fams = new Map();
  for (const k of keys) {
    const f = famOf(k);
    if (f === null) continue;
    fams.set(f, (fams.get(f) ?? 0) + 1);
  }

  const has = (from, to) => {
    let n = 0;
    for (const [f, c] of fams) if (f >= from && f <= to) n += c;
    return n;
  };

  rows.push({
    label,
    total: keys.length,
    eqHp: has(0xa1, 0xaa),
    eqIn: has(0x91, 0x94),
    loop: has(0x51, 0x58),
    duck: has(0x43, 0x43),
    fx: has(0x44, 0x44),
    comp: has(0x46, 0x46),
    meterMix: keys.filter((k) => /^3[1-8b-c]:15$/i.test(k)).length,
    famCount: fams.size,
  });
}

console.log('='.repeat(84));
console.log('СИГНАТУРЫ СОХРАНЁННЫХ ДАМПОВ');
console.log('='.repeat(84));
console.log(
  'режим'.padEnd(13)
  + 'тегов'.padStart(6)
  + 'сем'.padStart(5)
  + 'EQнауш'.padStart(8)
  + 'EQвход'.padStart(8)
  + 'loopb'.padStart(7)
  + 'duck'.padStart(6)
  + 'эфф'.padStart(5)
  + 'компр'.padStart(7)
  + 'метрыМикш'.padStart(11),
);
console.log('-'.repeat(84));

for (const r of rows) {
  if (r.missing) {
    console.log(`${r.label.padEnd(13)}  (файла нет)`);
    continue;
  }
  console.log(
    r.label.padEnd(13)
    + String(r.total).padStart(6)
    + String(r.famCount).padStart(5)
    + String(r.eqHp).padStart(8)
    + String(r.eqIn).padStart(8)
    + String(r.loop).padStart(7)
    + String(r.duck).padStart(6)
    + String(r.fx).padStart(5)
    + String(r.comp).padStart(7)
    + String(r.meterMix).padStart(11),
  );
}

console.log('');
console.log('='.repeat(84));
console.log('ВЫВОД');
console.log('='.repeat(84));
console.log(`
  Надёжный признак Prof  — наличие 0xa1..0xaa (EQ наушников).
  Признак Live vs Mobile — надо искать не в потоке, а в другом:
    микшер и loopback НИКОГДА не приходят в IN (IN=0 во всех захватах),
    поэтому их отсутствие в дампе ничего не говорит о режиме.

  Значит detectModeFromHid по 0x51..0x58 не может отличить Live от
  Mobile в принципе: loopback в потоке не появляется ни в одном режиме.
`);
