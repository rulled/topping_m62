/**
 * КОМПЛЕКСНАЯ ПРОВЕРКА ЗАПИСИ: loopback, outputs, ducking, компрессор.
 *
 * Меняем параметры во всех четырёх блоках ОДНИМ вызовом apply —
 * это один перезапуск MCC вместо четырёх.
 */
const PORT = process.env.M62_PORT ?? '8838';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const ws0 = await api('workspace');
console.log(`=== ДО (${ws0.mode}/${ws0.name}) ===`);

const lb = ws0.loopback.find((l) => l.id === 'Loopback_LB12');
const hp = ws0.outputs.find((o) => o.id === 'Output_HP');
const dk = ws0.ducking;
const cp = ws0.compressor;

console.log(`  Loopback_LB12: gain=${lb.gain} mute=${lb.mute}`);
console.log(`  Output_HP: gain=${hp.gain}`);
console.log(`  Ducking: threshold=${dk.threshold} release=${dk.release}`);
console.log(`  Compressor: threshold=${cp.threshold} ratio=${cp.ratio}`);

// готовим новые значения (заметно отличающиеся)
const CHANGES = [
  { section: 'Loopback_LB12', key: 'GAIN', value: lb.gain === -12 ? -13 : -12 },
  { section: 'Loopback_LB12', key: 'MUTE', value: lb.mute ? 'false' : 'true' },
  { section: 'Output_HP', key: 'GAIN', value: hp.gain === -20 ? -21 : -20 },
  { section: 'Ducking', key: 'Threshold', value: dk.threshold === -25 ? -26 : -25 },
  { section: 'Ducking', key: 'Release', value: dk.release === 800 ? 801 : 800 },
  { section: 'Compressor', key: 'Threshold', value: cp.threshold === -12 ? -13 : -12 },
  { section: 'Compressor', key: 'Ratio', value: cp.ratio === 6 ? 7 : 6 },
];

console.log('\nзаписываю:');
for (const c of CHANGES) console.log(`  ${c.section}.${c.key} = ${c.value}`);

const res = await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ changes: CHANGES }),
});
console.log(`\n  applied=${res.applied}, restarted=${res.restarted}`);

await sleep(2000);
const ws1 = await api('workspace?refresh=1');
console.log(`\n=== ПОСЛЕ (${ws1.mode}/${ws1.name}) ===`);

const lb1 = ws1.loopback.find((l) => l.id === 'Loopback_LB12');
const hp1 = ws1.outputs.find((o) => o.id === 'Output_HP');
const dk1 = ws1.ducking;
const cp1 = ws1.compressor;

console.log(`  Loopback_LB12: gain=${lb1.gain} mute=${lb1.mute}`);
console.log(`  Output_HP: gain=${hp1.gain}`);
console.log(`  Ducking: threshold=${dk1.threshold} release=${dk1.release}`);
console.log(`  Compressor: threshold=${cp1.threshold} ratio=${cp1.ratio}`);

// проверка
const checks = [
  ['Loopback_LB12.GAIN', lb1.gain === Number(CHANGES[0].value)],
  ['Loopback_LB12.MUTE', lb1.mute === (CHANGES[1].value === 'true')],
  ['Output_HP.GAIN', hp1.gain === Number(CHANGES[2].value)],
  ['Ducking.Threshold', dk1.threshold === Number(CHANGES[3].value)],
  ['Ducking.Release', dk1.release === Number(CHANGES[4].value)],
  ['Compressor.Threshold', cp1.threshold === Number(CHANGES[5].value)],
  ['Compressor.Ratio', cp1.ratio === Number(CHANGES[6].value)],
];
console.log('\n=== РЕЗУЛЬТАТ ===');
let ok = 0;
for (const [name, pass] of checks) {
  console.log(`  ${name.padEnd(26)} ${pass ? 'OK' : 'FAIL'}`);
  if (pass) ok++;
}
console.log(`\n  итого: ${ok}/${checks.length}`);
