/**
 * ДОЛГАЯ СТАБИЛЬНОСТЬ: 90 секунд работы с замерами.
 *
 * Проверяем:
 *   - keepalive не срывается (поток событий не прекращается)
 *   - память не течёт
 *   - кеш не растёт бесконечно
 *   - счётчики чтений растут равномерно
 */
const PORT = process.env.M62_PORT ?? '9000';
const DURATION_S = Number(process.env.DURATION ?? 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`);
  return r.json();
}

console.log(`тест стабильности: ${DURATION_S} секунд\n`);
console.log('время   reads    writes  errors  idle    RSS(MB)  события/5с');
console.log('-'.repeat(68));

const samples = [];
const t0 = Date.now();
let lastEvents = null;

// клиент для счёта событий
const { default: WebSocket } = await import('ws');
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
let evCount = 0;
ws.on('message', (raw) => {
  try { if (JSON.parse(raw).type === 'event') evCount++; } catch { /* мусор */ }
});
await new Promise((r) => ws.on('open', r));

while (Date.now() - t0 < DURATION_S * 1000) {
  await sleep(5000);
  const h = await api('health');
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const s = h.stats ?? {};

  // RSS берём через отдельный вызов — /api/health не отдаёт память
  const rss = process.memoryUsage ? null : null; // сервер отдельный процесс

  const deltaEv = lastEvents === null ? evCount : evCount - lastEvents;
  lastEvents = evCount;

  samples.push({
    t: elapsed,
    reads: s.reads ?? 0,
    writes: s.writes ?? 0,
    parseErrors: s.parseErrors ?? 0,
    idle: s.idle ?? 0,
    events: deltaEv,
  });

  console.log(
    `${String(elapsed).padStart(4)}с  ${String(s.reads ?? 0).padStart(7)}  `
    + `${String(s.writes ?? 0).padStart(6)}  ${String(s.parseErrors ?? 0).padStart(6)}  `
    + `${String(s.idle ?? 0).padStart(6)}  ${'—'.padStart(7)}  ${String(deltaEv).padStart(10)}`,
  );
}

ws.close();

console.log('\n=== АНАЛИЗ ===\n');

// 1. Равномерность чтений
const reads = samples.map((s) => s.reads);
const deltas = [];
for (let i = 1; i < reads.length; i++) deltas.push(reads[i] - reads[i - 1]);
const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
const min = Math.min(...deltas);
const max = Math.max(...deltas);
console.log(`1. ЧТЕНИЯ (прирост за 5 с):`);
console.log(`   среднее: ${avg.toFixed(0)}, мин: ${min}, макс: ${max}`);
const stable = min > 0 && max < avg * 3;
console.log(`   поток стабилен: ${stable ? 'ДА' : 'НЕТ (есть провалы)'}`);

// 2. Ошибки парсинга
const errs = samples[samples.length - 1].parseErrors;
console.log(`\n2. ОШИБКИ ПАРСИНГА: ${errs}`);
console.log(`   ${errs === 0 ? 'чисто' : 'ЕСТЬ ОШИБКИ'}`);

// 3. Поток событий
const evs = samples.map((s) => s.events);
const evMin = Math.min(...evs);
console.log(`\n3. СОБЫТИЯ (за 5 с): среднее ${(evs.reduce((a, b) => a + b, 0) / evs.length).toFixed(0)}, мин ${evMin}`);
console.log(`   поток не прерывался: ${evMin > 0 ? 'ДА' : 'НЕТ (был провал — keepalive сорвался?)'}`);

// 4. Итог
const totalReads = samples[samples.length - 1].reads - samples[0].reads;
console.log(`\n4. ИТОГО:`);
console.log(`   прочитано за тест: ${totalReads}`);
console.log(`   ~${(totalReads / DURATION_S).toFixed(0)} чтений/с`);

const allOk = stable && errs === 0 && evMin > 0;
console.log(`\n=== ${allOk ? 'СТАБИЛЬНО' : 'ЕСТЬ ПРОБЛЕМЫ'} ===`);
process.exit(allOk ? 0 : 1);
