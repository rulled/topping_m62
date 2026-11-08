/**
 * Проверка сцен через API settings/command.
 * Диагностика, почему coverage-тест иногда падает.
 */
const PORT = process.env.M62_PORT ?? '9102';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  return r.json();
}
async function post(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

const duck = async () => (await api('workspace?refresh=1')).ducking.switch;

console.log('=== ДИАГНОСТИКА СЦЕН ЧЕРЕЗ API ===\n');
console.log('исходное:', await duck());

console.log('\n--- sceneVocal ---');
const r1 = await post('settings/command', { id: 'sceneVocal' });
console.log('  ответ:', JSON.stringify(r1).slice(0, 120));
await sleep(2500);
console.log('  ducking:', await duck());

console.log('\n--- sceneChat ---');
const r2 = await post('settings/command', { id: 'sceneChat' });
console.log('  ответ:', JSON.stringify(r2).slice(0, 120));
await sleep(2500);
console.log('  ducking:', await duck());

console.log('\n--- ещё раз sceneChat (должен остаться 1) ---');
await post('settings/command', { id: 'sceneChat' });
await sleep(2000);
console.log('  ducking:', await duck());

console.log('\n--- возврат к Vocal ---');
await post('settings/command', { id: 'sceneVocal' });
await sleep(2000);
console.log('  ducking:', await duck());

console.log('\n=== ВЫВОД ===');
console.log('Если ducking переключается стабильно — проблема в тайминге теста.');
