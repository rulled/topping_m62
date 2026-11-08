/**
 * Проверка: применяются ли EQ-полосы к УСТРОЙСТВУ (а не только в файле)?
 *
 * Смотрим на HID-блоки 0x91 (появляются ли после записи полос).
 */
const PORT = process.env.M62_PORT ?? '8834';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// 1) состояние файла
let ws = await api('workspace');
const e1 = ws.eq.find((x) => x.id === 'EQ_IN1');
console.log(`файл EQ_IN1: switch=${e1.switch}`);
for (const b of e1.bands) console.log(`  полоса ${b.band}: gain=${b.gain} raw="${b.raw}"`);

// 2) HID
console.log('\n=== HID ===');
const hid = await api('health');
console.log(`  connected=${hid.connected}, reads=${hid.stats?.reads ?? '?'}`);

// читаем через device endpoint
const dev = await api('device');
console.log(`  device: ${dev.product ?? '?'} iface=${dev.interface ?? '?'}`);

// 3) пробуем записать Switch в другом формате (true вместо 1)
console.log('\n=== пробую Switch=true ===');
const res = await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    changes: [{ section: 'EQ_IN1', key: 'Switch', value: 'true' }],
  }),
});
console.log(`  applied=${res.applied}`);
await sleep(1500);

ws = await api('workspace?refresh=1');
const e1b = ws.eq.find((x) => x.id === 'EQ_IN1');
console.log(`  после: switch=${e1b.switch}`);
