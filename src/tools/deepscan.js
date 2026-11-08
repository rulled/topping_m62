/**
 * Глубокий пассивный сбор: длительное прослушивание + несколько ANNOUNCE,
 * чтобы вытянуть все статические параметры.
 *
 * ТОЛЬКО ЧТЕНИЕ. Пишем лишь подписку и запрос состояния — те же кадры,
 * что шлёт вендорское приложение при запуске.
 *
 * Использование: node src/tools/deepscan.js [секунды]
 */

import { writeFileSync } from 'node:fs';
import { M62Transport } from '../transport.js';
import { TT_DEVICE, PP_ANNOUNCE, PP_SUBSCRIBE } from '../protocol.js';

const SECONDS = Number(process.argv[2] ?? 60);

const map = new Map();

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
      last: null, changes: 0, firstAt: ev.at, lastAt: ev.at,
      values: new Map(),
    };
    map.set(key, e);
  }
  e.count++;
  e.lastAt = ev.at;
  if (ev.value < e.min) e.min = ev.value;
  if (ev.value > e.max) e.max = ev.value;
  if (e.last !== null && e.last !== ev.value) e.changes++;
  e.last = ev.value;
  e.values.set(ev.value, (e.values.get(ev.value) ?? 0) + 1);
});

t.on('error', (err) => {
  const c = err?.code ?? err?.errno;
  if (!['ENODEV', 'ESHUTDOWN', 'EPROTO', 'EILSEQ'].includes(c)) {
    console.log('[err]', err?.message ?? err);
  }
});

await t.open();
console.log(`слушаю ${SECONDS} с, запрашиваю состояние каждые 10 с…`);

// Периодически просим устройство объявить всё состояние —
// так вытягиваем статические параметры, которые иначе не приходят.
const announce = setInterval(() => {
  try {
    t.send(TT_DEVICE, PP_ANNOUNCE, 1);
  } catch { /* устройство отвалилось */ }
}, 10000);
announce.unref?.();

setTimeout(() => {
  clearInterval(announce);

  const rows = [...map.values()].sort((a, b) => a.tt - b.tt || a.pp - b.pp);
  const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;

  console.log('\n=== ПОЛНАЯ КАРТА ===');
  console.log('TT   PP   count  chg  min      max      uniq  тип');
  for (const e of rows) {
    let type = 'static';
    if (e.changes > 20) type = 'METER';
    else if (e.changes > 0) type = 'changing';
    console.log(
      `${hex(e.tt)} ${hex(e.pp)} ${String(e.count).padStart(6)} ` +
        `${String(e.changes).padStart(4)} ` +
        `${String(e.min).padStart(8)} ${String(e.max).padStart(8)} ` +
        `${String(e.values.size).padStart(5)}  ${type}`,
    );
  }

  const out = {
    at: new Date().toISOString(),
    seconds: SECONDS,
    stats: t.stats,
    total_tags: rows.length,
    entries: rows.map((e) => ({
      tt: e.tt, pp: e.pp,
      tt_hex: hex(e.tt), pp_hex: hex(e.pp),
      count: e.count, changes: e.changes,
      min: e.min, max: e.max,
      distinct: e.values.size,
      sample_values: [...e.values.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([v, n]) => ({ value: v, seen: n })),
      type: e.changes > 20 ? 'meter' : e.changes > 0 ? 'changing' : 'static',
    })),
  };

  writeFileSync('research/protocol-deep.json', JSON.stringify(out, null, 2));
  console.log(`\nзаписано: research/protocol-deep.json`);
  console.log(`всего различных TT/PP: ${rows.length}`);

  const families = new Map();
  for (const e of rows) {
    const f = e.tt & 0xf0;
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(e.pp);
  }
  console.log('\nсемейства по старшему нибблу TT:');
  for (const [f, pps] of [...families.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `  TT 0x${f.toString(16)}x : PP ${pps.map((p) => hex(p)).join(' ')}`,
    );
  }

  t.close();
  process.exit(0);
}, SECONDS * 1000);
