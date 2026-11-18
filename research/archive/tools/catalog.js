/**
 * Пассивный каталогизатор протокола.
 *
 * Слушает поток от устройства и строит карту всех встреченных TT/PP:
 * сколько раз пришло, минимум/максимум значения, меняется ли.
 *
 * НИЧЕГО НЕ ПИШЕТ в устройство, кроме подписки и запроса состояния —
 * это те же кадры, что шлёт вендорское приложение при запуске.
 *
 * Использование:
 *   node src/tools/catalog.js [секунды]
 */

import { writeFileSync } from 'node:fs';
import { M62Transport } from '../transport.js';
import { VOLUMES, SELECTORS } from '../controls.js';

const SECONDS = Number(process.argv[2] ?? 30);

/** @type {Map<string, {tt:number, pp:number, count:number, min:number, max:number, last:number, distinct:Set<number>, changes:number}>} */
const map = new Map();

const known = new Map();
for (const v of VOLUMES) known.set(`${v.target}:${v.prop}`, `VOLUME ${v.name}`);
for (const s of SELECTORS) known.set(`${s.target}:${s.prop}`, `SELECTOR ${s.name}`);

const t = new M62Transport({
  logger: { info: (...a) => console.log('[i]', ...a), warn: (...a) => console.log('[w]', ...a) },
});

t.on('event', (ev) => {
  const key = `${ev.target}:${ev.prop}`;
  let e = map.get(key);
  if (!e) {
    e = {
      tt: ev.target, pp: ev.prop,
      count: 0, min: Infinity, max: -Infinity,
      last: null, distinct: new Set(), changes: 0,
    };
    map.set(key, e);
  }
  e.count++;
  if (ev.value < e.min) e.min = ev.value;
  if (ev.value > e.max) e.max = ev.value;
  if (e.last !== null && e.last !== ev.value) e.changes++;
  e.last = ev.value;
  if (e.distinct.size < 64) e.distinct.add(ev.value);
});

t.on('error', (err) => console.log('[err]', err?.message ?? err));

await t.open();
console.log(`слушаю ${SECONDS} секунд…`);

setTimeout(() => {
  const rows = [...map.values()].sort((a, b) => a.tt - b.tt || a.pp - b.pp);

  console.log('\n=== КАРТА ПРОТОКОЛА ===');
  console.log(
    'TT   PP   count  changes  min      max      distinct  known',
  );
  for (const e of rows) {
    const k = `${e.tt}:${e.pp}`;
    const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;
    console.log(
      `${hex(e.tt)} ${hex(e.pp)} ${String(e.count).padStart(6)} ` +
        `${String(e.changes).padStart(8)} ` +
        `${String(e.min).padStart(8)} ${String(e.max).padStart(8)} ` +
        `${String(e.distinct.size).padStart(8)}  ${known.get(k) ?? '—'}`,
    );
  }

  const out = {
    at: new Date().toISOString(),
    seconds: SECONDS,
    stats: t.stats,
    entries: rows.map((e) => ({
      tt: e.tt,
      pp: e.pp,
      tt_hex: `0x${e.tt.toString(16).padStart(2, '0')}`,
      pp_hex: `0x${e.pp.toString(16).padStart(2, '0')}`,
      count: e.count,
      changes: e.changes,
      min: e.min,
      max: e.max,
      distinct: [...e.distinct].slice(0, 64),
      known: known.get(`${e.tt}:${e.pp}`) ?? null,
      looks_like_meter: e.changes > 10,
    })),
  };

  const path = 'research/protocol-map.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nзаписано: ${path}`);
  console.log(`всего разных TT/PP: ${rows.length}`);

  const meters = out.entries.filter((e) => e.looks_like_meter);
  console.log(`похожи на метры (часто меняются): ${meters.length}`);
  for (const m of meters) {
    console.log(
      `   ${m.tt_hex}:${m.pp_hex}  range ${m.min}..${m.max}  (${m.changes} изменений)`,
    );
  }

  t.close();
  process.exit(0);
}, SECONDS * 1000);
