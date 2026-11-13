/**
 * ГИПОТЕЗА: ДЛЯ EQ НУЖНЫ ДРУГИЕ БАЙТЫ ЗАГОЛОВКА.
 *
 * ═══ ЧТО НАВЕЛО ═══
 *
 * Кадр устроен так:
 *
 *     22 33 | 20 01 01 | TT | PP | value | crc | 66 77
 *            ^^^^^^^^^
 *            байты 2..4 — мы ВСЕГДА шлём 20 01 01
 *
 * Все 9 способов записи EQ использовали этот заголовок. Если для
 * DSP-блоков прошивка ждёт другое значение — вот и причина отказа.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Смотрит в захватах, какие байты 2..4 ПРИСЫЛАЕТ САМА КАРТА
 *    для разных семейств. Если для EQ-блоков они отличаются —
 *    это сильная зацепка.
 * 2. Показывает, какие заголовки использовал MCC.
 *
 * Запуск: node src/tools/analyze-frame-headers.js
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'research';
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findCaps() {
  const out = [];
  const walk = (dir, d = 0) => {
    if (d > 3) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, d + 1);
      else if (name.endsWith('.pcap')) out.push(p);
    }
  };
  walk(DIR);
  return out;
}

/**
 * Разбор pcap: возвращает кадры с заголовком.
 * direction: 'out' (хост->устройство) или 'in' (устройство->хост)
 */
function framesOf(path) {
  const buf = readFileSync(path);
  if (buf.length < 24) return [];
  const little = buf[0] === 0xd4;
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  let off = 24;
  const res = [];
  const MAGIC = Buffer.from([0x22, 0x33]);
  while (off + 16 <= buf.length) {
    let incl;
    try {
      incl = u32(off + 8);
    } catch {
      break;
    }
    off += 16;
    if (incl > buf.length - off) break;
    const data = buf.subarray(off, off + incl);
    off += incl;
    if (data.length < 27) continue;
    const hlen = data.readUInt16LE(0);
    if (hlen < 27 || hlen > data.length) continue;
    const ep = data[21];
    const dlen = data.readUInt32LE(23);
    if (hlen + dlen > data.length) continue;
    const payload = data.subarray(hlen, hlen + dlen);
    let s = 0;
    while (true) {
      const p = payload.indexOf(MAGIC, s);
      if (p < 0) break;
      const c = payload.subarray(p, p + 15);
      if (c.length === 15 && c[13] === 0x66 && c[14] === 0x77) {
        res.push({
          dir: ep & 0x80 ? 'in' : 'out',
          h2: c[2],
          h3: c[3],
          h4: c[4],
          tt: c[5],
          pp: c[6],
          value: c.readInt32BE(7),
        });
      }
      s = p + 1;
    }
  }
  return res;
}

const caps = findCaps().sort((a, b) => statSync(b).size - statSync(a).size);
console.log('='.repeat(76));
console.log('БАЙТЫ ЗАГОЛОВКА (2..4) ПО СЕМЕЙСТВАМ');
console.log('='.repeat(76));

// агрегируем: (dir, tt) -> Set заголовков
const byDirTt = new Map();
for (const cap of caps) {
  let fr;
  try {
    fr = framesOf(cap);
  } catch {
    continue;
  }
  for (const f of fr) {
    const key = `${f.dir}|${hex2(f.tt)}`;
    if (!byDirTt.has(key)) byDirTt.set(key, new Map());
    const h = `${hex2(f.h2)} ${hex2(f.h3)} ${hex2(f.h4)}`;
    byDirTt.get(key).set(h, (byDirTt.get(key).get(h) || 0) + 1);
  }
}

const eqFamilies = new Set(['91', '92', '93', '94', '9b', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa']);

console.log('\n--- УСТРОЙСТВО -> ХОСТ (in) ---');
const rowsIn = [...byDirTt.entries()]
  .filter(([k]) => k.startsWith('in|'))
  .sort((a, b) => a[0].localeCompare(b[0]));
for (const [key, headers] of rowsIn) {
  const tt = key.split('|')[1];
  const mark = eqFamilies.has(tt) ? ' <-- EQ' : '';
  const hs = [...headers.entries()]
    .map(([h, n]) => `${h} (${n}x)`)
    .join('  |  ');
  console.log(`  0x${tt}${mark}`);
  console.log(`       ${hs}`);
}

console.log('\n--- ХОСТ -> УСТРОЙСТВО (out) ---');
const rowsOut = [...byDirTt.entries()]
  .filter(([k]) => k.startsWith('out|'))
  .sort((a, b) => a[0].localeCompare(b[0]));
for (const [key, headers] of rowsOut) {
  const tt = key.split('|')[1];
  const mark = eqFamilies.has(tt) ? ' <-- EQ' : '';
  const hs = [...headers.entries()]
    .map(([h, n]) => `${h} (${n}x)`)
    .join('  |  ');
  console.log(`  0x${tt}${mark}`);
  console.log(`       ${hs}`);
}

// ─── вывод: есть ли в in-кадрах EQ заголовок, отличный от 20 01 01 ───
console.log('\n' + '='.repeat(76));
console.log('ОТВЕТ НА ГЛАВНЫЙ ВОПРОС');
console.log('='.repeat(76));

const eqHeaders = new Set();
for (const [key, headers] of rowsIn) {
  const tt = key.split('|')[1];
  if (!eqFamilies.has(tt)) continue;
  for (const h of headers.keys()) eqHeaders.add(h);
}

console.log('  заголовки, которыми карта присылает EQ-блоки:');
for (const h of eqHeaders) console.log(`    ${h}`);

const standardOnly = eqHeaders.size === 1 && eqHeaders.has('20 01 01');
if (standardOnly) {
  console.log('\n  Карта присылает EQ ТЕМ ЖЕ заголовком 20 01 01.');
  console.log('  Значит заголовок не различает семейства — гипотеза мимо.');
  console.log('  Причина отказа записи в EQ иная.');
} else if (eqHeaders.size) {
  console.log('\n  ЗАГОЛОВКИ ОТЛИЧАЮТСЯ! Это зацепка: возможно, для записи');
  console.log('  в EQ нужен заголовок из этого списка, а не 20 01 01.');
} else {
  console.log('\n  EQ-кадров в захватах не найдено.');
}

// ─── все заголовки в out-кадрах ───
const outHeaders = new Set();
for (const [key, headers] of rowsOut) {
  for (const h of headers.keys()) outHeaders.add(h);
}
console.log('\n  все заголовки, которыми писал MCC:');
for (const h of outHeaders) console.log(`    ${h}`);
