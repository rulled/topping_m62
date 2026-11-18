/**
 * ПОЛНАЯ ПРОВЕРКА WEBSOCKET: команды от клиента.
 *
 * Фронт будет слать setVolume/setSelector/getState — проверяем,
 * что они реально работают и возвращают ответ.
 */
import WebSocket from 'ws';

const PORT = process.env.M62_PORT ?? '8970';
const WS = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

const ws = new WebSocket(WS);
const inbox = [];

ws.on('open', () => console.log('WS открыт\n'));
ws.on('message', (raw) => {
  try {
    inbox.push(JSON.parse(raw));
  } catch { /* мусор */ }
});
ws.on('error', (e) => console.log('WS ошибка:', e.message));

await new Promise((r) => ws.on('open', r));
await sleep(1500);

/** Отправить и дождаться ack с нужным op. */
async function sendAndWait(msg, op, timeoutMs = 5000) {
  inbox.length = 0;
  ws.send(JSON.stringify(msg));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = inbox.find((m) => m.type === 'ack' && (!op || m.op === op));
    if (hit) return hit;
    const err = inbox.find((m) => m.type === 'error');
    if (err) return err;
    await sleep(120);
  }
  return null;
}

console.log('=== 1. hello ===');
const hello = inbox.find((m) => m.type === 'hello');
check('получен hello', Boolean(hello));
if (hello) {
  check('hello.controls есть', Boolean(hello.controls));
  check('hello.eqMixer есть', Boolean(hello.eqMixer));
  check('hello.protocol есть', Boolean(hello.protocol));
  console.log(`     громкостей: ${hello.controls?.volumes?.length}`);
}

console.log('\n=== 2. getState ===');
inbox.length = 0;
ws.send(JSON.stringify({ type: 'getState' }));
await sleep(1500);
const state = inbox.find((m) => m.type === 'state');
check('getState вернул state', Boolean(state));
if (state) {
  check('state.controls есть', Boolean(state.controls));
  console.log(`     ключи: ${Object.keys(state).join(', ')}`);
}

console.log('\n=== 3. setVolume ===');
// найдём текущую громкость
const ctl = hello?.controls?.volumes?.find((v) => v.id === 'hp');
const oldVal = ctl?.current ?? 50;
const newVal = oldVal === 50 ? 40 : 50;
const ackVol = await sendAndWait({ type: 'setVolume', id: 'hp', value: newVal }, 'volume');
check('setVolume вернул ack', Boolean(ackVol) && ackVol.type === 'ack', ackVol ? ackVol.op : 'нет ответа');
if (ackVol?.type === 'ack') {
  check('ack.value правильный', Number(ackVol.value) === newVal, `${ackVol.value}`);
}
// вернуть
await sendAndWait({ type: 'setVolume', id: 'hp', value: oldVal }, 'volume');

console.log('\n=== 4. setVolume с ошибкой ===');
const badVol = await sendAndWait({ type: 'setVolume', id: 'nonexistent', value: 10 }, null);
check('ошибка вернулась как error', Boolean(badVol) && badVol.type === 'error',
  badVol ? String(badVol.message).slice(0, 40) : 'нет');

console.log('\n=== 5. setSelector ===');
const sel = hello?.controls?.selectors?.find((s) => s.id === 'hpSource');
const ackSel = await sendAndWait({ type: 'setSelector', id: 'hpSource', index: 1 }, 'selector');
check('setSelector вернул ack', Boolean(ackSel) && ackSel.type === 'ack', ackSel ? ackSel.op : 'нет');
if (ackSel?.type === 'ack') {
  check('ack.label есть', Boolean(ackSel.label), ackSel.label);
  // вернуть Unknown (no-op)
  await sendAndWait({ type: 'setSelector', id: 'hpSource', index: 0 }, 'selector');
}

console.log('\n=== 6. setSetting (toggle) ===');
const ackSet = await sendAndWait({ type: 'setSetting', id: 'bluetooth', value: 1 }, 'setting');
check('setSetting toggle вернул ack', Boolean(ackSet) && ackSet.type === 'ack', ackSet?.op ?? 'нет');

console.log('\n=== 6б. setSetting (enum) ===');
const brCur = hello?.controls ? null : null;
const ackEnum = await sendAndWait({ type: 'setSetting', id: 'brightness', value: 2, enum: true }, 'setting');
check('setSetting enum вернул ack', Boolean(ackEnum) && ackEnum.type === 'ack', ackEnum?.label ?? 'нет');

console.log('\n=== 6в. runCommand ===');
const ackCmd = await sendAndWait({ type: 'runCommand', id: 'loadPreset1' }, 'command');
check('runCommand вернул ack', Boolean(ackCmd) && ackCmd.type === 'ack', ackCmd?.name ?? 'нет');

console.log('\n=== 7. неизвестная команда ===');
inbox.length = 0;
ws.send(JSON.stringify({ type: 'nonexistentCommand' }));
await sleep(1000);
const unknownResp = inbox.find((m) => m.type === 'error' || m.type === 'ack');
check('неизвестная команда не ломает WS', ws.readyState === WebSocket.OPEN, `state=${ws.readyState}`);

console.log('\n=== 7. WS всё ещё работает ===');
const ackAfter = await sendAndWait({ type: 'setVolume', id: 'hp', value: oldVal }, 'volume');
check('после всех команд WS работает', Boolean(ackAfter) && ackAfter.type === 'ack');
await sendAndWait({ type: 'setVolume', id: 'hp', value: oldVal }, 'volume');

console.log('\n=== 8. события приходят ===');
inbox.length = 0;
await sleep(3000);
const events = inbox.filter((m) => m.type === 'event');
check('события идут', events.length > 0, `${events.length} за 3 с`);
if (events.length) {
  const kinds = [...new Set(events.map((e) => e.kind))];
  console.log(`     типы: ${kinds.join(', ')}`);
}

console.log('\n' + '='.repeat(55));
const ok = results.filter((r) => r.ok).length;
console.log(`ИТОГО: ${ok}/${results.length}`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('НЕ ПРОШЛИ:');
  for (const f of failed) console.log(`  ${f.name}`);
}

ws.close();
process.exit(ok === results.length ? 0 : 1);
