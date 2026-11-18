/**
 * Проверка записи EQ_HP в Pro audio mode.
 */
const PORT = process.env.M62_PORT ?? '8835';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

let ws = await api('workspace');
console.log(`=== ДО (${ws.mode}/${ws.name}) ===`);
let hp = ws.eq.find((e) => e.id === 'EQ_HP');
if (!hp) { console.log('EQ_HP нет'); process.exit(0); }
console.log(`  switch=${hp.switch} gainOutput=${hp.gainOutput}`);
for (const b of hp.bands) console.log(`    полоса ${b.band}: raw="${b.raw}" gain=${b.gain} freq=${b.freq} Q=${b.q}`);

// запишем gain полосы 1 = 5 (было 9)
const oldRaw = hp.bands[0].raw;
const parts = oldRaw.split('|');
// формат: тип|gain|частота|Q|?
parts[1] = '5';
const newRaw = parts.join('|');
console.log(`\nзаписываю EQ_HP.Eq%401: "${oldRaw}" -> "${newRaw}"`);

const res = await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ changes: [{ section: 'EQ_HP', key: 'Eq%401', value: newRaw }] }),
});
console.log(`  applied=${res.applied}, restarted=${res.restarted}`);

await sleep(1500);
ws = await api('workspace?refresh=1');
hp = ws.eq.find((e) => e.id === 'EQ_HP');
console.log(`\n=== ПОСЛЕ ===`);
console.log(`  switch=${hp.switch} gainOutput=${hp.gainOutput}`);
for (const b of hp.bands) console.log(`    полоса ${b.band}: raw="${b.raw}" gain=${b.gain}`);

const okBand = hp.bands[0].gain === 5;
const okSwitch = hp.switch === true;
console.log(`\nрезультат: полоса1.gain=${okBand ? 'OK' : 'FAIL'} switch=${okSwitch ? 'OK (сохранился)' : 'FAIL'}`);
