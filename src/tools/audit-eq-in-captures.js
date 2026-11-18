/**
 * ШЛЁТ ЛИ MCC КОГДА-НИБУДЬ КАДРЫ 0x91..0x94?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Сегодня выяснилось:
 *   - устройство ПРИСЫЛАЕТ EQ-блоки (probe-eq-arrival: 40 адресов);
 *   - прямая запись в 0x91:03 НЕ принимается (4 способа, все мимо);
 *   - при нажатии кнопки EQ в MCC не уходит НИ ОДНОГО кадра HID;
 *   - в eq-switch.pcap вообще нет исходящих 0x91..0x94.
 *
 * Если MCC НИКОГДА не пишет 0x91..0x94, значит EQ через HID не
 * управляется ВООБЩЕ, и наш `/api/eq/band` врёт (кеш).
 * Это надо проверить по ВСЕМ сохранённым захватам.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Проходит по всем *.pcap в research/ и считает исходящие кадры
 * по семействам. Отдельно: были ли среди них 0x91..0x94 и 0x9b.
 *
 * Запуск: node src/tools/audit-eq-in-captures.js
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'research';
const hex2 = (n) => n.toString(16).padStart(2, '0');

function readCaptures() {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p, depth + 1);
      } else if (name.endsWith('.pcap')) {
        out.push({ path: p, size: st.size });
      }
    }
  };
  walk(DIR);
  return out;
}

/** Разбор pcap -> список (tt, pp) исходящих кадров. */
function outgoingFrames(path) {
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
    if (ep & 0x80) continue; // только хост -> устройство
    const dlen = data.readUInt32LE(23);
    if (hlen + dlen > data.length) continue;
    const payload = data.subarray(hlen, hlen + dlen);
    let s = 0;
    while (true) {
      const p = payload.indexOf(MAGIC, s);
      if (p < 0) break;
      const c = payload.subarray(p, p + 15);
      if (c.length === 15 && c[13] === 0x66 && c[14] === 0x77) {
        res.push({ tt: c[5], pp: c[6], value: c.readInt32BE(7) });
      }
      s = p + 1;
    }
  }
  return res;
}

const captures = readCaptures().sort((a, b) => b.size - a.size);
console.log('='.repeat(74));
console.log(`АУДИТ: ШЛЁТ ЛИ MCC КАДРЫ EQ (0x91..0x94)?`);
console.log('='.repeat(74));
console.log(`найдено захватов: ${captures.length}\n`);

const SUMMARY = { eq: 0, nineB: 0, total: 0, withEq: [], withB: [] };

for (const cap of captures) {
  let frames;
  try {
    frames = outgoingFrames(cap.path);
  } catch {
    console.log(`  ${cap.path}: не читается`);
    continue;
  }
  if (!frames.length) {
    console.log(`  ${cap.path.padEnd(52)} кадров хоста: 0 (пропуск)`);
    continue;
  }

  const fam = {};
  for (const f of frames) fam[hex2(f.tt)] = (fam[hex2(f.tt)] || 0) + 1;

  const eqFrames = frames.filter((f) => /^9[1-4]$/.test(hex2(f.tt)));
  const bFrames = frames.filter((f) => f.tt === 0x9b);

  SUMMARY.total += frames.length;
  SUMMARY.eq += eqFrames.length;
  SUMMARY.nineB += bFrames.length;
  if (eqFrames.length) SUMMARY.withEq.push({ path: cap.path, n: eqFrames.length, frames: eqFrames });
  if (bFrames.length) SUMMARY.withB.push({ path: cap.path, n: bFrames.length, frames: bFrames });

  console.log(
    `${cap.path.replace(/\\/g, '/').padEnd(50)} `
    + `кадров ${String(frames.length).padStart(4)}  `
    + `EQ 0x91-94: ${String(eqFrames.length).padStart(3)}  `
    + `0x9b: ${String(bFrames.length).padStart(3)}`,
  );
}

console.log('\n' + '='.repeat(74));
console.log('ИТОГ');
console.log('='.repeat(74));
console.log(`  всего исходящих кадров во всех захватах: ${SUMMARY.total}`);
console.log(`  из них в 0x91..0x94 (EQ-полосы):        ${SUMMARY.eq}`);
console.log(`  из них в 0x9b (EQ-переключатели):       ${SUMMARY.nineB}`);

if (SUMMARY.eq === 0 && SUMMARY.nineB === 0) {
  console.log('\n  >>> MCC НИ РАЗУ не записал ни в 0x91..0x94, ни в 0x9b.');
  console.log('  >>> Значит EQ ЧЕРЕЗ HID НЕ УПРАВЛЯЕТСЯ ВООБЩЕ.');
  console.log('');
  console.log('  Следствия:');
  console.log('    - /api/eq/band и /api/eq/switch НЕ РАБОТАЮТ (кеш врёт);');
  console.log('    - NOTES §135.2 «7 из 7 принято» — ошибка измерения');
  console.log('      (читали из кеша, а не с устройства);');
  console.log('    - EQ в нашем клиенте можно только ЧИТАТЬ.');
} else {
  console.log('\n  MCC пишет EQ. Смотрим, в каких захватах и что именно:');
  for (const c of SUMMARY.withEq) {
    console.log(`\n  ${c.path}  (${c.n} кадров 0x91..0x94)`);
    for (const f of c.frames.slice(0, 20)) {
      console.log(`    0x${hex2(f.tt)}:0x${hex2(f.pp)} = ${f.value}`);
    }
  }
  for (const c of SUMMARY.withB) {
    console.log(`\n  ${c.path}  (${c.n} кадров 0x9b)`);
    for (const f of c.frames.slice(0, 20)) {
      console.log(`    0x9b:0x${hex2(f.pp)} = ${f.value}`);
    }
  }
}
