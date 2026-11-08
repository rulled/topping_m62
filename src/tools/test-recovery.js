/**
 * ПРОВЕРКА АВТОВОССТАНОВЛЕНИЯ после потери устройства.
 *
 * Сценарий: пользователь выдернул кабель и воткнул обратно.
 * Бекенд должен сам восстановиться, без перезапуска.
 */
const PORT = process.env.M62_PORT ?? '8990';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
    return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, ok: false, body: { error: e.message } };
  }
}

console.log('=== 1. исходное состояние ===');
let h = await api('health');
console.log(`  connected: ${h.body.connected}`);
console.log(`  reads: ${h.body.stats?.reads}`);

console.log('\n=== 2. disconnect (имитация выдёргивания) ===');
let r = await api('disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
console.log(`  HTTP ${r.status}`);

await sleep(1500);
h = await api('health');
console.log(`  connected после disconnect: ${h.body.connected}`);
console.log(`  reads: ${h.body.stats?.reads}`);

console.log('\n=== 3. запросы при отключённом устройстве ===');
for (const ep of ['controls', 'settings', 'workspace', 'mode']) {
  const x = await api(ep);
  console.log(`  /api/${ep}: HTTP ${x.status}`);
}

console.log('\n=== 4. ждём 5 секунд — восстановится ли само? ===');
await sleep(5000);
h = await api('health');
console.log(`  connected: ${h.body.connected}`);
const autoRecovered = h.body.connected === true;
console.log(`  автоматическое восстановление: ${autoRecovered ? 'ДА' : 'НЕТ'}`);

console.log('\n=== 5. явный connect ===');
r = await api('connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
console.log(`  HTTP ${r.status}, connected: ${r.body?.connected}`);

await sleep(3000);
h = await api('health');
console.log(`  connected: ${h.body.connected}`);
console.log(`  reads: ${h.body.stats?.reads}`);

console.log('\n=== 6. работает ли управление после восстановления ===');
const c = await api('controls');
const hp = c.body.volumes?.find((v) => v.id === 'hp');
if (hp) {
  const old = hp.current ?? 50;
  const w = await api('volume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'hp', value: old === 50 ? 45 : 50 }),
  });
  console.log(`  запись громкости: HTTP ${w.status}`);
  await sleep(600);
  const c2 = await api('controls');
  const now = c2.body.volumes?.find((v) => v.id === 'hp')?.current;
  console.log(`  значение после: ${now}`);
  await api('volume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'hp', value: old }),
  });
}

console.log('\n=== ИТОГ ===');
console.log(`  автовосстановление: ${autoRecovered ? 'есть' : 'ОТСУТСТВУЕТ — нужен явный /api/connect'}`);
