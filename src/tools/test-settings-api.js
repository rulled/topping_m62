/**
 * ПРОВЕРКА API ЗАПИСИ НАСТРОЕК на живом устройстве.
 *
 * /api/settings/toggle, /api/settings/enum — раньше не проверялись записью.
 */
const PORT = process.env.M62_PORT ?? '8853';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body)}`);
  return body;
}

async function post(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

console.log('=== ТЕКУЩИЕ НАСТРОЙКИ ===');
let s = await api('settings?refresh=1');
const cur = {};
for (const t of s.toggles) { cur[t.id] = t.value; console.log(`  ${t.id.padEnd(18)} = ${t.value} (${t.label})`); }
for (const e of s.enums) { if (e.readable) { cur[e.id] = e.value; console.log(`  ${e.id.padEnd(18)} = ${e.value} (${e.label})`); } else { console.log(`  ${e.id.padEnd(18)} = (не читается)`); } }

const results = [];

// --- toggle: bluetooth ---
console.log('\n=== toggle: bluetooth ===');
const blWant = cur.bluetooth === 1 ? 0 : 1;
try {
  const r = await post('settings/toggle', { id: 'bluetooth', value: blWant });
  console.log(`  записал ${blWant}: ${r.label}`);
  await sleep(2000);
  const s2 = await api('settings?refresh=1');
  const got = s2.toggles.find((t) => t.id === 'bluetooth').value;
  const ok = got === blWant;
  console.log(`  проверка: ${got}  ${ok ? 'OK' : 'FAIL'}`);
  results.push(['toggle bluetooth', ok]);
} catch (e) { console.log(`  FAIL: ${e.message}`); results.push(['toggle bluetooth', false]); }

// --- enum: brightness ---
console.log('\n=== enum: brightness ===');
const brCur = (await api('settings?refresh=1')).enums.find((e) => e.id === 'brightness').value;
const brWant = brCur === 2 ? 0 : 2;
try {
  const r = await post('settings/enum', { id: 'brightness', value: brWant });
  console.log(`  записал ${brWant}: ${r.label}`);
  await sleep(2000);
  const s2 = await api('settings?refresh=1');
  const got = s2.enums.find((e) => e.id === 'brightness').value;
  const ok = got === brWant;
  console.log(`  проверка: ${got}  ${ok ? 'OK' : 'FAIL'}`);
  results.push(['enum brightness', ok]);
  // вернуть
  await post('settings/enum', { id: 'brightness', value: brCur });
} catch (e) { console.log(`  FAIL: ${e.message}`); results.push(['enum brightness', false]); }

// --- enum: usbCPower ---
console.log('\n=== enum: usbCPower ===');
const ucCur = (await api('settings?refresh=1')).enums.find((e) => e.id === 'usbCPower').value;
const ucWant = ucCur === 1 ? 2 : 1;
try {
  const r = await post('settings/enum', { id: 'usbCPower', value: ucWant });
  console.log(`  записал ${ucWant}: ${r.label}`);
  await sleep(2000);
  const s2 = await api('settings?refresh=1');
  const got = s2.enums.find((e) => e.id === 'usbCPower').value;
  const ok = got === ucWant;
  console.log(`  проверка: ${got}  ${ok ? 'OK' : 'FAIL'}`);
  results.push(['enum usbCPower', ok]);
  await post('settings/enum', { id: 'usbCPower', value: ucCur });
} catch (e) { console.log(`  FAIL: ${e.message}`); results.push(['enum usbCPower', false]); }

// --- вернуть bluetooth ---
if (cur.bluetooth !== undefined) await post('settings/toggle', { id: 'bluetooth', value: cur.bluetooth });
await sleep(1000);

console.log('\n=== ИТОГ ===');
let ok = 0;
for (const [n, p] of results) { console.log(`  ${n.padEnd(22)} ${p ? 'OK' : 'FAIL'}`); if (p) ok++; }
console.log(`  ${ok}/${results.length}`);
