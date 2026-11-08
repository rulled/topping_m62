/**
 * ЧТО ТАКОЕ comp9 (0x4609) И comp13 (0x460d)?
 *
 * Наблюдения:
 *   comp9  = -800  всегда, ровно, без изменений
 *   comp10 = 0     всегда
 *   comp12 = реагирует на громкость (-902..-542)
 *   comp13 = реагирует на громкость (-902..-642), но упирается в пол
 *
 * Гипотеза: comp9 — фиксированная константа (порог?), comp13 — уровень ПОСЛЕ
 * компрессора (то есть с учётом редукции).
 *
 * Проверка: если comp13 = вход − редукция, то при включении компрессора с
 * жёсткими настройками comp13 должен стать МЕНЬШЕ comp12.
 */
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const r = await fetch('http://127.0.0.1:8787/api/' + path,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return r.json();
}

const all = async () => {
  const m = (await api('meters')).meters;
  const get = (id) => m.find((x) => x.id === id)?.raw ?? null;
  return {
    in1: get('meter_IN1'), fxIn: get('meter_fxIn'), fxOut: get('meter_fxOut'),
    eq: get('meter_eqMeter'),
    c9: get('meter_comp9'), c10: get('meter_comp10'), c12: get('meter_comp12'), c13: get('meter_comp13'),
  };
};

console.log('=== выключаю компрессор ===');
await api('compressor/switch', { id: 'switch', value: false });
await sleep(1500);

console.log('gaining mic1...');
const rows = [];
for (const g of [40, 60, 80, 88]) {
  await api('volume', { id: 'mic1', value: g });
  await sleep(2200);
  const s = await all();
  rows.push({ g, on: false, ...s });
  console.log(`  OFF gain=${String(g).padStart(3)}  in1=${String(s.in1).padStart(5)} c12=${String(s.c12).padStart(5)} c13=${String(s.c13).padStart(5)} c9=${s.c9} c10=${s.c10}`);
}

console.log('\n=== включаю компрессор (Threshold=0, Ratio=inf) ===');
await api('compressor/param', { param: 'Threshold', value: 0 });
await api('compressor/param', { param: 'Ratio', value: 1000000 });
await api('compressor/switch', { id: 'switch', value: true });
await sleep(1500);

for (const g of [40, 60, 80, 88]) {
  await api('volume', { id: 'mic1', value: g });
  await sleep(2200);
  const s = await all();
  rows.push({ g, on: true, ...s });
  console.log(`  ON  gain=${String(g).padStart(3)}  in1=${String(s.in1).padStart(5)} c12=${String(s.c12).padStart(5)} c13=${String(s.c13).padStart(5)} c9=${s.c9} c10=${s.c10}`);
}

await api('volume', { id: 'mic1', value: 44 });
await sleep(1000);

console.log('\n=== СРАВНЕНИЕ (OFF vs ON при одинаковом входе) ===');
for (const g of [40, 60, 80, 88]) {
  const off = rows.find((r) => r.g === g && !r.on);
  const on = rows.find((r) => r.g === g && r.on);
  if (!off || !on) continue;
  const d12 = on.c12 - off.c12;
  const d13 = on.c13 - off.c13;
  console.log(`  gain=${String(g).padStart(3)}  c12 ${off.c12}->${on.c12} (${d12 >= 0 ? '+' : ''}${d12})   c13 ${off.c13}->${on.c13} (${d13 >= 0 ? '+' : ''}${d13})`);
}

console.log('\n=== ГИПОТЕЗА comp9 = фиксированная константа ===');
const c9vals = [...new Set(rows.map((r) => r.c9))];
console.log(`  уникальные значения comp9: ${JSON.stringify(c9vals)}`);
const c10vals = [...new Set(rows.map((r) => r.c10))];
console.log(`  уникальные значения comp10: ${JSON.stringify(c10vals)}`);

console.log('\nвосстанавливаю компрессор: Threshold=-28, Ratio=4, switch=on');
await api('compressor/param', { param: 'Threshold', value: -28 });
await api('compressor/param', { param: 'Ratio', value: 4 });
await api('compressor/switch', { id: 'switch', value: true });
const fin = (await api('compressor')).values;
console.log('  итог:', JSON.stringify(fin));
