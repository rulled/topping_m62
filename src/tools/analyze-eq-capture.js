/**
 * ПОЛНЫЙ РАЗБОР eq-switch.pcap: ВСЕ кадры, а не только EQ-семейства.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * При нажатии кнопки EQ в MCC не ушло ни одного кадра 0x9b и ни одного
 * 0x91..0x94. Значит переключатель живёт в ДРУГОМ семействе — надо
 * смотреть все кадры в окне вокруг кликов.
 *
 * Метод: считаем «фон» — адреса, которые MCC шлёт постоянно (микшер,
 * keepalive). Затем ищем кадры, которые встречаются РЕДКО и попали
 * в окно клика. Это и есть реакция на нажатие.
 *
 * Запуск: node src/tools/analyze-eq-capture.js [файл]
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
  if (ep & 0x80) continue;

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

console.log('='.repeat(74));
console.log(`ПОЛНЫЙ РАЗБОР ${FILE}`);
console.log('='.repeat(74));
console.log(`кадров хоста: ${frames.length}`);
if (!frames.length) process.exit(0);
const tEnd = frames[frames.length - 1].ms;
console.log(`диапазон: ${frames[0].ms} … ${tEnd} ms`);

// ─── 1. карта плотности по времени ───
console.log('\n' + '-'.repeat(74));
console.log('КАРТА ПО ВРЕМЕНИ (кадров на 5-секундный бин)');
console.log('-'.repeat(74));
const BIN = 5000;
const bins = {};
for (const f of frames) {
  const b = Math.floor(f.ms / BIN) * BIN;
  bins[b] = (bins[b] || 0) + 1;
}
for (const b of Object.keys(bins).map(Number).sort((a, c) => a - c)) {
  const bar = '#'.repeat(Math.min(60, Math.round(bins[b] / 2)));
  console.log(`  ${String(Math.round(b / 1000)).padStart(4)}s  ${String(bins[b]).padStart(4)}  ${bar}`);
}

// ─── 2. фон: адреса, которые шлются постоянно ───
const counts = {};
for (const f of frames) {
  const k = `${hex2(f.tt)}:${hex2(f.pp)}`;
  counts[k] = (counts[k] || 0) + 1;
}
console.log('\n' + '-'.repeat(74));
console.log('ФОНОВЫЕ АДРЕСА (>= 6 кадров) — это состояние/keepalive, не реакции');
console.log('-'.repeat(74));
const bg = Object.entries(counts).filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]);
for (const [k, n] of bg) console.log(`  0x${k}  n=${n}`);

// ─── 3. редкие кадры: кандидаты в реакции на действие ───
console.log('\n' + '-'.repeat(74));
console.log('РЕДКИЕ АДРЕСА (< 6 кадров) — кандидаты в переключатели');
console.log('-'.repeat(74));
const rare = Object.entries(counts).filter(([, n]) => n < 6).sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, n] of rare) {
  const vs = frames.filter((f) => `${hex2(f.tt)}:${hex2(f.pp)}` === k);
  const uniq = [...new Set(vs.map((v) => v.value))];
  console.log(
    `  0x${k}  n=${n}  значения=[${uniq.slice(0, 8).join(', ')}${uniq.length > 8 ? ',…' : ''}]  `
    + `ms=[${vs.slice(0, 8).map((v) => v.ms).join(', ')}${vs.length > 8 ? ',…' : ''}]`,
  );
}

// ─── 4. хвост: что было ПОСЛЕ основной инициализации ───
// инициализация MCC заканчивается примерно к 30-35 с; клики были позже
console.log('\n' + '-'.repeat(74));
console.log('КАДРЫ ПОСЛЕ 30 с (то есть после инициализации — там должны быть клики)');
console.log('-'.repeat(74));
const late = frames.filter((f) => f.ms > 30000);
if (!late.length) {
  console.log('  кадров после 30 с нет — MCC вообще молчал после инициализации');
  console.log('  => при нажатии кнопки EQ он НЕ отправлял ничего в устройство');
} else {
  console.log(`  кадров: ${late.length}`);
  const lateCnt = {};
  for (const f of late) {
    const k = `${hex2(f.tt)}:${hex2(f.pp)}`;
    lateCnt[k] = (lateCnt[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(lateCnt).sort((a, b) => b[1] - a[1])) {
    const vs = late.filter((f) => `${hex2(f.tt)}:${hex2(f.pp)}` === k);
    const uniq = [...new Set(vs.map((v) => v.value))];
    console.log(`  0x${k}  n=${n}  значения=[${uniq.join(', ')}]  ms=[${vs.map((v) => v.ms).join(', ')}]`);
  }
}

console.log('\n' + '='.repeat(74));
console.log('ВЫВОД');
console.log('='.repeat(74));
console.log('  Если после 30 с вообще нет кадров — MCC при клике EQ ничего');
console.log('  не отправил. Значит EQ применяется НЕ через HID, а иначе');
console.log('  (файл/драйвер), либо кнопка меняет только вид панели.');
