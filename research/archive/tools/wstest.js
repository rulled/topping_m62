/**
 * Проверка WebSocket: подключается, получает hello, слушает события.
 * Использование: node src/tools/wstest.js [порт] [секунды]
 */
import WebSocket from 'ws';

const PORT = Number(process.argv[2] ?? 8787);
const SECONDS = Number(process.argv[3] ?? 6);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
let events = 0;

ws.on('open', () => console.log('WS открыт'));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'hello') {
    console.log('hello: connected =', m.connected);
    console.log('  волумов  :', m.controls.volumes.length);
    console.log('  селекторов:', m.controls.selectors.length);
    console.log('  источников:', m.controls.sources.length);
    console.log('  протокол :', JSON.stringify(m.protocol));
    // Тест команды
    ws.send(JSON.stringify({ type: 'getState' }));
  } else if (m.type === 'event') {
    events++;
    if (events <= 5) {
      console.log(`event: kind=${m.kind} id=${m.id ?? '-'} value=${m.value} raw=${m.target}:${m.prop}`);
    }
  } else {
    console.log('msg:', m.type, JSON.stringify(m).slice(0, 160));
  }
});
ws.on('error', (e) => console.log('WS ошибка:', e.message));
ws.on('close', () => console.log('WS закрыт'));

setTimeout(() => {
  console.log(`\nсобытий получено: ${events}`);
  ws.close();
  process.exit(0);
}, SECONDS * 1000);
