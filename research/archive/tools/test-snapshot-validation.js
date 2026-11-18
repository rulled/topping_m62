/**
 * ПРОВЕРКА: обходит ли applySnapshot валидацию?
 *
 * Создаём снимок, портим в нём значения, применяем — должен ли быть отказ.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.M62_PORT ?? '9200';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
async function post(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

console.log('=== 1. создаю снимок ===');
const snap = await post('snapshots', { label: 'validation-test' });
if (!snap.body.path) { console.log('  FAIL создать снимок'); process.exit(1); }
console.log(`  ${snap.body.path}`);

const file = snap.body.path.split('\\').pop();
console.log(`  файл: ${file}`);

console.log('\n=== 2. ПОРЧУ снимок: неверные значения ===');
const p = join('research', 'snapshots', file);
const data = JSON.parse(readFileSync(p, 'utf8'));

// ломаем микшер
if (data.workspace?.mixer?.length) {
  const ch = data.workspace.mixer[0];
  if (ch.buses?.A) {
    ch.buses.A.gain = 9999;
    console.log(`  Mixer ${ch.channel}.A.gain = 9999`);
  }
}
// ломаем EQ
if (data.workspace?.eq?.length) {
  const eq = data.workspace.eq[0];
  if (eq.bands?.length) {
    eq.bands[0].raw = '|0|999999|1|0';
    console.log(`  EQ ${eq.id} band1 = |0|999999|1|0`);
  }
}
// ломаем выход
if (data.workspace?.outputs?.length) {
  data.workspace.outputs[0].gain = -9999;
  console.log(`  Output ${data.workspace.outputs[0].id}.gain = -9999`);
}

writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
console.log('  снимок испорчен');

console.log('\n=== 3. ПРИМЕНЯЮ испорченный снимок ===');
const apply = await post('snapshots/apply', { file });
console.log(`  HTTP ${apply.status}`);
console.log('  ответ:', JSON.stringify(apply.body).slice(0, 200));

console.log('\n=== ВЫВОД ===');
if (apply.status === 400) {
  console.log('  ЗАЩИЩЕНО: валидация работает и для снимков');
} else if (apply.status === 200) {
  console.log('  *** ДЫРА: испорченный снимок ПРИМЕНИЛСЯ! ***');
  console.log('  applySnapshot обходит валидацию');
} else {
  console.log(`  неожиданный ответ: ${apply.status}`);
}

// удаляю тестовый снимок
await post('snapshots/delete', { file });
console.log('\n(тестовый снимок удалён)');
