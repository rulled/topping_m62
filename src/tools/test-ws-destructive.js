/**
 * ПРОВЕРКА ЗАЩИТЫ ОПАСНЫХ КОМАНД ЧЕРЕЗ WEBSOCKET.
 *
 * HTTP защищён (требует confirm). А WebSocket?
 * Если нет — это дыра: можно случайно сбросить устройство.
 */
import WebSocket from 'ws';

const PORT = process.env.M62_PORT ?? '9171';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const inbox = [];
ws.on('message', (raw) => {
  try { inbox.push(JSON.parse(raw)); } catch { /* мусор */ }
});
await new Promise((r) => ws.on('open', r));
await sleep(1500);

async function send(msg, timeoutMs = 4000) {
  inbox.length = 0;
  ws.send(JSON.stringify(msg));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ack = inbox.find((m) => m.type === 'ack' && m.op === 'command');
    const err = inbox.find((m) => m.type === 'error');
    if (ack) return { type: 'ack', msg: ack };
    if (err) return { type: 'error', msg: err };
    await sleep(120);
  }
  return null;
}

console.log('=== WS: updateFirmware БЕЗ confirm ===');
const r1 = await send({ type: 'runCommand', id: 'updateFirmware' });
console.log('  ответ:', JSON.stringify(r1).slice(0, 160));
if (r1?.type === 'error') {
  console.log('  ЗАЩИЩЕНО');
} else if (r1?.type === 'ack') {
  console.log('  *** ОПАСНО: команда ПРОШЛА без confirm! ***');
} else {
  console.log('  нет ответа');
}

console.log('\n=== WS: restoreDefault БЕЗ confirm ===');
const r2 = await send({ type: 'runCommand', id: 'restoreDefault' });
console.log('  ответ:', JSON.stringify(r2).slice(0, 160));
if (r2?.type === 'error') {
  console.log('  ЗАЩИЩЕНО');
} else if (r2?.type === 'ack') {
  console.log('  *** ОПАСНО: команда ПРОШЛА без confirm! ***');
} else {
  console.log('  нет ответа');
}

console.log('\n=== WS: безопасная команда ===');
const r3 = await send({ type: 'runCommand', id: 'loadPreset1' });
console.log('  ответ:', JSON.stringify(r3).slice(0, 120));

ws.close();
process.exit(0);
