/**
 * ПРОВЕРКА НАДЁЖНОСТИ: бекенд не падает при ошибках устройства.
 *
 * Проверяем:
 *   1) запросы при отсутствии устройства — внятная ошибка, не крэш
 *   2) запросы до открытия / после закрытия
 *   3) неверные входные данные
 */
const PORT = process.env.M62_PORT ?? '8892';

async function api(path, opts) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
    const body = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: { error: 'сеть: ' + e.message } };
  }
}

async function post(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: cond });
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

console.log('=== 1. НЕВЕРНЫЕ ВХОДНЫЕ ДАННЫЕ ===');

let r = await post('volume', { id: 'nonexistent', value: 50 });
check('volume с неизвестным id', r.status === 400, `HTTP ${r.status}`);

r = await post('volume', { id: 'hp', value: 9999 });
check('volume вне диапазона', r.status === 400, `HTTP ${r.status}`);

r = await post('volume', { id: 'hp', value: 'abc' });
check('volume с NaN', r.status === 400, `HTTP ${r.status}`);

r = await post('selector', { id: 'nonexistent', index: 1 });
check('selector с неизвестным id', r.status === 400, `HTTP ${r.status}`);

r = await post('settings/toggle', { id: 'nonexistent', value: 1 });
check('toggle с неизвестным id', r.status === 400, `HTTP ${r.status}`);

r = await post('settings/enum', { id: 'brightness', value: 99 });
check('enum вне диапазона', r.status === 400, `HTTP ${r.status}`);

r = await post('settings/command', { id: 'nonexistent' });
check('command с неизвестным id', r.status === 400, `HTTP ${r.status}`);

r = await post('settings/command', { id: 'restoreDefault' });
check('restoreDefault без confirm', r.status === 400 && String(r.body.error).includes('необратим'),
  `HTTP ${r.status}`);

r = await post('workspace/apply', { changes: [{ section: 'NoSuch', key: 'X', value: 1 }] });
check('workspace с неверной секцией', r.status === 400, `HTTP ${r.status}`);

r = await post('reverb', { type: 'NONEXISTENT' });
check('реверб с неверным типом', r.status === 400, `HTTP ${r.status}`);

r = await api('nonexistent-endpoint');
check('несуществующий эндпоинт -> 404', r.status === 404, `HTTP ${r.status}`);

console.log('\n=== 2. КОРРЕКТНЫЕ ЗАПРОСЫ ВСЁ ЕЩЁ РАБОТАЮТ ===');
r = await api('health');
check('health после ошибок', r.ok === true);
r = await api('controls');
check('controls после ошибок', r.ok === true && Array.isArray(r.body.volumes));

console.log('\n=== 3. ЗАКРЫТИЕ УСТРОЙСТВА ===');
r = await post('disconnect', {});
check('disconnect не падает', r.status === 200 || r.status === 400, `HTTP ${r.status}`);

r = await api('health');
check('health после disconnect', r.status === 200, `connected=${r.body.connected}`);

r = await api('controls');
check('controls после disconnect', r.ok === true, `volumes=${r.body.volumes?.length ?? '?'}`);

r = await api('workspace');
check('workspace после disconnect', r.ok === true, `available=${r.body.available}`);

// попытка записи при закрытом устройстве
r = await post('volume', { id: 'hp', value: 50 });
check('volume при закрытом устройстве -> ошибка', r.status === 400, `HTTP ${r.status}`);

console.log('\n=== 4. ВОССТАНОВЛЕНИЕ ===');
r = await post('connect', {});
check('connect восстанавливает', r.ok === true, `connected=${r.body.connected}`);

r = await api('controls');
check('controls после connect', r.ok === true);

console.log('\n' + '='.repeat(55));
const ok = results.filter((x) => x.ok).length;
console.log(`ИТОГО: ${ok}/${results.length}`);
const failed = results.filter((x) => !x.ok);
if (failed.length) {
  console.log('НЕ ПРОШЛИ:');
  for (const f of failed) console.log(`  ${f.name}`);
}
