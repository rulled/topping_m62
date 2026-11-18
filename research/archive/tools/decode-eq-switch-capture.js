/**
 * РАЗБОР eq-switch.pcap: что MCC шлёт при нажатии кнопки EQ.
 *
 * Отдельный скрипт, потому что при первом прогоне файл ещё был
 * заблокирован процессом USBPcap (EBUSY).
 *
 * Запуск: node src/tools/decode-eq-switch-capture.js [файл]
 */

import { readFileSync, existsSync } from 'node:fs';

const FILE = process.argv[2] ?? 'research/eq-switch.pcap';
const hex2 = (n) => n.toString(16).padStart(2, '0');

if (!existsSync(FILE)) {
  console.error(`нет файла: ${FILE}`);
  process.exit(1);
}

const buf = readFileSync(FILE);
const little = buf[0] === 0xd4;
const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

let off = 24;
const frames = [];
let baseTs = null;

while (off + 16 <= buf.length) {
  const tsSec = u32(off);
  const tsUsec = u32(off + 4);
  const incl = u32(off + 8);
  off += 16;
  const data = buf.subarray(off, off + incl);
  off += incl;
  if (data.length < 27) continue;
  const hlen = data.readUInt16LE(0);
  if (hlen < 27 || hlen > data.length) continue;
  const ep = data[21];
  const dlen = data.readUInt32LE(23);
  if (hlen + dlen > data.length) continue;
  const payload = data.subarray(hlen, hlen + dlen);
  if (ep & 0x80) continue; // только хост -> устройство

  const ts = tsSec * 1000 + Math.floor(tsUsec / 1000);
  if (baseTs === null) baseTs = ts;

  let s = 0;
  while (true) {
    const p = payload.indexOf(Buffer.from([0x22, 0x33]), s);
    if (p < 0) break;
    const c = payload.subarray(p, p + 15);
    if (c.length === 15 && c[13] === 0x66 && c[14] === 0x77) {
      frames.push({ ms: ts - baseTs, tt: c[5], pp: c[6], value: c.readInt32BE(7) });
    }
    s = p + 1;
  }
}

console.log('='.repeat(70));
console.log(`РАЗБОР ${FILE}`);
console.log('='.repeat(70));
console.log(`кадров хоста: ${frames.length}`);
if (!frames.length) process.exit(0);
console.log(`диапазон: ${frames[0].ms} … ${frames[frames.length - 1].ms} ms`);

// ─── все семейства ───
const byTt = {};
for (const f of frames) byTt[hex2(f.tt)] = (byTt[hex2(f.tt)] || 0) + 1;
console.log('\nвсе семейства:');
for (const tt of Object.keys(byTt).sort()) console.log(`  0x${tt}: ${byTt[tt]}`);

// ─── EQ-семейства по порядку ───
const EQ_TT = new Set(['91', '92', '93', '94', '9b']);
const eq = frames.filter((f) => EQ_TT.has(hex2(f.tt)));
console.log(`\nкадров EQ (0x91..0x94, 0x9b): ${eq.length}`);
for (const f of eq) {
  console.log(`  ${String(f.ms).padStart(7)} ms  0x${hex2(f.tt)}:0x${hex2(f.pp)} = ${f.value}`);
}

// ─── «редкие» кадры: те, что встречаются 1-4 раза ───
// именно они — кандидаты в переключатели
const counts = {};
for (const f of frames) {
  const k = `${hex2(f.tt)}:${hex2(f.pp)}`;
  counts[k] = (counts[k] || 0) + 1;
}
console.log('\n' + '='.repeat(70));
console.log('РЕДКИЕ АДРЕСА (1..5 кадров) — кандидаты в переключатели');
console.log('='.repeat(70));
const rare = Object.entries(counts)
  .filter(([, n]) => n >= 1 && n <= 5)
  .sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, n] of rare) {
  const vals = frames.filter((f) => `${hex2(f.tt)}:${hex2(f.pp)}` === k);
  const uniq = [...new Set(vals.map((v) => v.value))];
  console.log(
    `  0x${k}  n=${n}  значения: ${uniq.join(', ')}  ms: ${vals.map((v) => v.ms).join(', ')}`,
  );
}

// ─── 0x9b отдельно: писал ли MCC туда вообще ───
const nineB = frames.filter((f) => f.tt === 0x9b);
console.log('\n' + '='.repeat(70));
console.log('СЕМЕЙСТВО 0x9b — ПИШЕТ ЛИ MCC ТУДА?');
console.log('='.repeat(70));
if (!nineB.length) {
  console.log('  MCC НЕ ОТПРАВИЛ НИ ОДНОГО КАДРА 0x9b.');
  console.log('  Значит 0x9b — только чтение, подтверждено независимо.');
  console.log('  Переключатель EQ живёт в ДРУГОМ семействе — смотри выше.');
} else {
  console.log(`  кадров 0x9b: ${nineB.length}`);
  for (const f of nineB) {
    console.log(`  ${String(f.ms).padStart(7)} ms  0x9b:0x${hex2(f.pp)} = ${f.value}`);
  }
}
