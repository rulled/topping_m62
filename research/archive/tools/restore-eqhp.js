/** Восстановить EQ_HP полосу 1 = 9 и вернуть Live-режим. */
const PORT = process.env.M62_PORT ?? '8836';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// вернуть полосу 1 на 9
console.log('возвращаю EQ_HP.Eq%401 = 0|9|35|0.5395|1');
const res = await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    changes: [{ section: 'EQ_HP', key: 'Eq%401', value: '0|9|35|0.5395|1' }],
  }),
});
console.log(`  applied=${res.applied}`);
await sleep(1500);

const ws = await api('workspace?refresh=1');
const hp = ws.eq.find((e) => e.id === 'EQ_HP');
console.log(`  EQ_HP полоса 1: raw="${hp.bands[0].raw}" gain=${hp.bands[0].gain}`);
console.log(hp.bands[0].gain === 9 ? '  восстановлено OK' : '  НЕ восстановлено');
