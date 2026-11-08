/**
 * ПРОВЕРКА ЗАПИСИ EQ: меняем gain полосы и включаем EQ через файл.
 *
 * Формат полосы EQ_IN1: |тип|частота|Q|gain|
 * Значит gain=6 при частоте 632 и Q 0.7 -> |0|632|0.7|6
 */
const PORT = process.env.M62_PORT ?? '8833';

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function apply(changes) {
  return api('workspace/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
}

function eqBand(ws, id) {
  const e = ws.eq.find((x) => x.id === id);
  return e ?? null;
}

console.log('=== ДО ===');
let ws = await api('workspace');
let e1 = eqBand(ws, 'EQ_IN1');
console.log(`  EQ_IN1: switch=${e1.switch}`);
for (const b of e1.bands) {
  console.log(`    полоса ${b.band}: тип=${b.type} freq=${b.freq} Q=${b.q} gain=${b.gain}  raw="${b.raw}"`);
}

// ставим gain=6 на полосу 1, gain=-4 на полосу 2, включаем EQ
const newBand1 = '|0|632|0.7|6';
const newBand2 = '|0|632|0.7|-4';

console.log(`\nзаписываю: EQ_IN1.Switch=1, Eq%401="${newBand1}", Eq%402="${newBand2}"`);
const res = await apply([
  { section: 'EQ_IN1', key: 'Switch', value: 1 },
  { section: 'EQ_IN1', key: 'Eq%401', value: newBand1 },
  { section: 'EQ_IN1', key: 'Eq%402', value: newBand2 },
]);
console.log(`  applied=${res.applied}, restarted=${res.restarted}`);

await new Promise((r) => setTimeout(r, 1500));
console.log('\n=== ПОСЛЕ ===');
ws = await api('workspace?refresh=1');
e1 = eqBand(ws, 'EQ_IN1');
console.log(`  EQ_IN1: switch=${e1.switch}`);
for (const b of e1.bands) {
  console.log(`    полоса ${b.band}: тип=${b.type} freq=${b.freq} Q=${b.q} gain=${b.gain}  raw="${b.raw}"`);
}

const okSwitch = e1.switch === true;
const okB1 = e1.bands[0]?.gain === 6;
const okB2 = e1.bands[1]?.gain === -4;
console.log(`\nрезультат: Switch=${okSwitch ? 'OK' : 'FAIL'} полоса1.gain=${okB1 ? 'OK' : 'FAIL'} полоса2.gain=${okB2 ? 'OK' : 'FAIL'}`);
