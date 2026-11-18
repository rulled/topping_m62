/**
 * Почему сцены иногда не срабатывают в coverage-тесте?
 *
 * Гипотеза: MCC только что перезапущен и ещё не готов,
 * ИЛИ ducking уже включён от предыдущего теста.
 */
const PORT = process.env.M62_PORT ?? '9111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${p}`);
  return r.json();
}
async function post(p, d) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d),
  });
  return r.json();
}

console.log('=== состояние ===');
const h = await api('health');
console.log(`  connected: ${h.connected}`);
console.log(`  uptime: ${h.uptimeSec} с`);

let d = (await api('workspace?refresh=1')).ducking.switch;
console.log(`  ducking сейчас: ${d}`);

console.log('\n=== Vocal -> ждём -> читаем ===');
console.log('  отправлен:', JSON.stringify(await post('settings/command', { id: 'sceneVocal' })).slice(0, 80));
for (const wait of [1000, 2000, 3000]) {
  await sleep(wait);
  d = (await api('workspace?refresh=1')).ducking.switch;
  console.log(`  через +${wait}мс: ${d}`);
}

console.log('\n=== Chat -> ждём -> читаем ===');
console.log('  отправлен:', JSON.stringify(await post('settings/command', { id: 'sceneChat' })).slice(0, 80));
for (const wait of [1000, 2000, 3000]) {
  await sleep(wait);
  d = (await api('workspace?refresh=1')).ducking.switch;
  console.log(`  через +${wait}мс: ${d}`);
}

console.log('\n=== ИЩУ СКОЛЬКО ВРЕМЕНИ НУЖНО НА САМОМ ДЕЛЕ ===');
await post('settings/command', { id: 'sceneVocal' });
await sleep(4000);
console.log(`  baseline (Vocal): ${(await api('workspace?refresh=1')).ducking.switch}`);

const t0 = Date.now();
await post('settings/command', { id: 'sceneChat' });
let found = false;
for (let i = 0; i < 30; i++) {
  await sleep(300);
  d = (await api('workspace?refresh=1')).ducking.switch;
  if (d === 1) {
    console.log(`  ducking стал 1 через ${Date.now() - t0} мс`);
    found = true;
    break;
  }
}
if (!found) console.log('  ducking НЕ стал 1 за 9 секунд — проблема не в тайминге!');

// вернуть
await post('settings/command', { id: 'sceneVocal' });
await sleep(1500);
console.log(`\nвернул: ${(await api('workspace?refresh=1')).ducking.switch}`);
