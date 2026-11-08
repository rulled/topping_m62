/**
 * ПРОВЕРКА ВАЛИДАЦИИ ЗНАЧЕНИЙ WORKSPACE (без MCC).
 *
 * При запущенном MCC запрос отклоняется раньше — из-за "MCC запущен".
 * Нужно проверить именно валидацию значений.
 */
import { execFileSync } from 'node:child_process';

const PORT = process.env.M62_PORT ?? '9186';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

async function post(path, data) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

console.log('останавливаю MCC, чтобы проверить чистую валидацию...');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('\n=== ГРАНИЦЫ МИКШЕРА (-90..12) ===');
let r = await post('workspace/apply', {
  changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: 999 }], restart: false,
});
check('MixA_GAIN=999 отклонено', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

r = await post('workspace/apply', {
  changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: -500 }], restart: false,
});
check('MixA_GAIN=-500 отклонено', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

console.log('\n=== ГРАНИЦЫ EQ ===');
r = await post('workspace/apply', {
  changes: [{ section: 'EQ_IN1', key: 'Eq%401', value: '|0|999999|0.7|0' }], restart: false,
});
check('EQ freq=999999 отклонено', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

r = await post('workspace/apply', {
  changes: [{ section: 'EQ_IN1', key: 'Eq%401', value: 'garbage' }], restart: false,
});
check('EQ мусор отклонён', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

r = await post('workspace/apply', {
  changes: [{ section: 'EQ_IN1', key: 'Eq%401', value: '|0|1000|1|999' }], restart: false,
});
check('EQ gain=999 отклонён', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

console.log('\n=== ГРАНИЦЫ 48V / MUTE ===');
r = await post('workspace/apply', {
  changes: [{ section: 'Input_IN1', key: '48V', value: 5 }], restart: false,
});
check('48V=5 отклонено', r.status === 400, `HTTP ${r.status}: ${String(r.body.error).slice(0, 55)}`);

console.log('\n' + '='.repeat(55));
const ok = results.filter((x) => x.ok).length;
console.log(`ИТОГО: ${ok}/${results.length}`);
for (const f of results.filter((x) => !x.ok)) console.log(`  НЕ ПРОШЛО: ${f.name}`);

console.log('\nвозвращаю MCC...');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);
