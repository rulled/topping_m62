/**
 * ПРОВЕРКА ВАЛИДАЦИИ: границы значений в workspace/apply.
 *
 * Файл не валидирует EQ (проверено §63). Но бекенд должен.
 */
const PORT = process.env.M62_PORT ?? '9180';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, data) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}
async function get(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`);
  return r.json();
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

console.log('=== 1. ГРОМКОСТЬ: границы ===');
let r = await post('volume', { id: 'hp', value: 100 });
check('hp=100 отклонено (max 99)', r.status === 400, `HTTP ${r.status}`);
r = await post('volume', { id: 'hp', value: -1 });
check('hp=-1 отклонено', r.status === 400, `HTTP ${r.status}`);
r = await post('volume', { id: 'mic1', value: 89 });
check('mic1=89 отклонено (max 88)', r.status === 400, `HTTP ${r.status}`);

console.log('\n=== 2. НАСТРОЙКИ: границы ===');
r = await post('settings/enum', { id: 'brightness', value: 3 });
check('brightness=3 отклонено (max 2)', r.status === 400, `HTTP ${r.status}`);
r = await post('settings/toggle', { id: 'bluetooth', value: 5 });
check('bluetooth=5 отклонено', r.status === 400, `HTTP ${r.status}`);

console.log('\n=== 3. WORKSPACE: что с неверными значениями? ===');
// границы микшера: -90..12
r = await post('workspace/apply', {
  changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: 999 }],
  restart: false,
});
check('MixA_GAIN=999 (вне -90..12)', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 60)}`);

r = await post('workspace/apply', {
  changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: -500 }],
  restart: false,
});
check('MixA_GAIN=-500 отклонено', r.status === 400, `HTTP ${r.status}`);

console.log('\n=== 4. EQ: границы ===');
r = await post('workspace/apply', {
  changes: [{ section: 'EQ_IN1', key: 'Eq%401', value: '|0|999999|0.7|0' }],
  restart: false,
});
check('EQ freq=999999 отклонено', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 50)}`);

r = await post('workspace/apply', {
  changes: [{ section: 'EQ_IN1', key: 'Eq%401', value: 'garbage' }],
  restart: false,
});
check('EQ мусорная строка отклонена', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 50)}`);

console.log('\n=== 5. НЕВЕРНЫЕ СЕКЦИИ И КЛЮЧИ ===');
r = await post('workspace/apply', { changes: [{ section: 'NoSuchSection', key: 'X', value: 1 }], restart: false });
check('несуществующая секция', r.status === 400, `HTTP ${r.status}`);
r = await post('workspace/apply', { changes: [{ section: 'Mixer_IN12', key: 'NoSuchKey', value: 1 }], restart: false });
check('несуществующий ключ', r.status === 400, `HTTP ${r.status}`);

console.log('\n' + '='.repeat(55));
const ok = results.filter((x) => x.ok).length;
console.log(`ИТОГО: ${ok}/${results.length}`);
for (const f of results.filter((x) => !x.ok)) console.log(`  НЕ ПРОШЛО: ${f.name}`);
