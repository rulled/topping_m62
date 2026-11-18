/**
 * ПРОВЕРКА СОБЫТИЙ: приходят ли они при изменении состояния?
 *
 * Критично для фронта: если менять громкость из другого клиента,
 * увидит ли первый клиент это событие? Если нет — нужен polling.
 */
import WebSocket from 'ws';

const PORT = process.env.M62_PORT ?? '8980';
const WS = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

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

// Клиент A — слушает события
const wsA = new WebSocket(WS);
const eventsA = [];
wsA.on('message', (raw) => {
  try {
    const m = JSON.parse(raw);
    if (m.type === 'event') eventsA.push(m);
  } catch { /* мусор */ }
});
await new Promise((r) => wsA.on('open', r));
await sleep(1500);

console.log('=== 1. слушаем 2 секунды без действий ===');
eventsA.length = 0;
await sleep(2000);
const idle = [...eventsA];
const idleKinds = [...new Set(idle.map((e) => e.kind))];
console.log(`  событий: ${idle.length}, типы: ${idleKinds.join(', ') || 'нет'}`);
check('поток идёт (метры)', idle.length > 0, `${idle.length}`);

console.log('\n=== 2. меняем громкость через API — ждём событие volume ===');
eventsA.length = 0;
const ctl = await api('controls');
const hp = ctl.volumes.find((v) => v.id === 'hp');
const oldVal = hp.current ?? 50;
const newVal = oldVal === 50 ? 45 : 50;
await post('volume', { id: 'hp', value: newVal });

let volEvent = null;
for (let i = 0; i < 30; i++) {
  await sleep(150);
  volEvent = eventsA.find((e) => e.kind === 'volume' && e.id === 'hp');
  if (volEvent) break;
}
check('событие volume пришло', Boolean(volEvent),
  volEvent ? `${volEvent.id}=${volEvent.value}` : 'НЕ ПРИШЛО');

// вернуть
await post('volume', { id: 'hp', value: oldVal });
await sleep(800);

console.log('\n=== 3. меняем настройку — ждём событие setting ===');
eventsA.length = 0;
const st = await api('settings?refresh=1');
const br = st.enums.find((e) => e.id === 'brightness');
const brNew = br.value === 2 ? 1 : 2;
await post('settings/enum', { id: 'brightness', value: brNew });

let setEvent = null;
for (let i = 0; i < 30; i++) {
  await sleep(150);
  setEvent = eventsA.find((e) => e.kind === 'setting' && e.id === 'brightness');
  if (setEvent) break;
}
check('событие setting пришло', Boolean(setEvent),
  setEvent ? `${setEvent.id}=${setEvent.value}` : 'НЕ ПРИШЛО');
await post('settings/enum', { id: 'brightness', value: br.value });
await sleep(800);

console.log('\n=== 4. голосовая команда из другого клиента (WS) ===');
eventsA.length = 0;
const wsB = new WebSocket(WS);
await new Promise((r) => wsB.on('open', r));
wsB.send(JSON.stringify({ type: 'setVolume', id: 'hp', value: newVal }));

let crossEvent = null;
for (let i = 0; i < 30; i++) {
  await sleep(150);
  crossEvent = eventsA.find((e) => e.kind === 'volume' && e.id === 'hp');
  if (crossEvent) break;
}
check('клиент A видит изменение от клиента B', Boolean(crossEvent),
  crossEvent ? `hp=${crossEvent.value}` : 'НЕ ПРИШЛО');
wsB.close();
await sleep(600);
await post('volume', { id: 'hp', value: oldVal });

console.log('\n=== 5. ВСЕ ВСТРЕЧЕННЫЕ ТИПЫ СОБЫТИЙ ===');
const allKinds = new Set();
eventsA.length = 0;
await sleep(3000);
for (const e of eventsA) allKinds.add(e.kind);
console.log(`  ${[...allKinds].join(', ') || 'нет'}`);

console.log('\n' + '='.repeat(55));
const ok = results.filter((r) => r.ok).length;
console.log(`ИТОГО: ${ok}/${results.length}`);
for (const f of results.filter((r) => !r.ok)) console.log(`  НЕ ПРОШЛО: ${f.name}`);

wsA.close();
process.exit(ok === results.length ? 0 : 1);
