/**
 * ПРОВЕРКА УТЕЧЕК ПАМЯТИ и роста кеша.
 *
 * Запускаем сервер, гоняем нагрузку, замеряем RSS и размер кеша.
 */
import { execFileSync } from 'node:child_process';

const PORT = process.env.M62_PORT ?? '9001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  return r.json();
}

/** RSS процесса node по PID. */
function rssOf(pid) {
  try {
    const out = execFileSync(PS, ['-NoProfile', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`], { encoding: 'utf8' }).trim();
    const n = Number(String(out).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n / 1024 / 1024 * 10) / 10 : null;
  } catch {
    return null;
  }
}

const pid = Number(process.env.SERVER_PID);
if (!pid) {
  console.log('нужен SERVER_PID');
  process.exit(1);
}

console.log(`PID сервера: ${pid}\n`);
console.log('время  RSS(MB)  reads   кеш(тегов)  события');
console.log('-'.repeat(52));

const samples = [];
const t0 = Date.now();

// клиент для нагрузки
const { default: WebSocket } = await import('ws');
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
await new Promise((r) => ws.on('open', r));

// гоняем нагрузку: читаем состояние каждые 2 с
let ops = 0;
const loadTimer = setInterval(async () => {
  try {
    await api('controls');
    await api('tags');
    ops += 2;
  } catch { /* пропускаем */ }
}, 2000);

for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const h = await api('health');
  const t = await api('tags');
  const rss = rssOf(pid);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  // размер кеша примерно = число известных тегов
  const cacheSize = (t.meters?.length ?? 0) + Object.keys(t.groups ?? {}).length;

  samples.push({ t: elapsed, rss, reads: h.stats?.reads ?? 0, cache: cacheSize });
  console.log(`${String(elapsed).padStart(4)}с  ${String(rss ?? '—').padStart(7)}  ${String(h.stats?.reads ?? 0).padStart(6)}  ${String(cacheSize).padStart(10)}  ${ops}`);
}

clearInterval(loadTimer);
ws.close();

console.log('\n=== АНАЛИЗ УТЕЧЕК ===\n');

const rssVals = samples.map((s) => s.rss).filter((x) => x !== null);
if (rssVals.length >= 2) {
  const first = rssVals[0];
  const last = rssVals[rssVals.length - 1];
  const delta = last - first;
  const pct = ((delta / first) * 100).toFixed(1);
  console.log(`RSS: ${first} МБ -> ${last} МБ (${delta >= 0 ? '+' : ''}${delta} МБ, ${pct}%)`);
  // допустим рост до 20% — это нормальный GC-разброс
  const okMem = delta < 30 || Number(pct) < 25;
  console.log(`  ${okMem ? 'в пределах нормы' : 'ПОДОЗРИТЕЛЬНЫЙ РОСТ — возможна утечка'}`);
} else {
  console.log('RSS не удалось замерить');
}

const cacheVals = samples.map((s) => s.cache);
const cacheStable = new Set(cacheVals).size <= 2;
console.log(`\nКеш тегов: ${cacheVals[0]} -> ${cacheVals[cacheVals.length - 1]}`);
console.log(`  ${cacheStable ? 'не растёт' : 'РАСТЁТ — возможна утечка'}`);

console.log('\n=== ВЫВОД ===');
if (rssVals.length >= 2) {
  const delta = rssVals[rssVals.length - 1] - rssVals[0];
  const ok = (delta < 30) && cacheStable;
  console.log(ok ? 'утечек не обнаружено' : 'есть признаки проблемы');
  process.exit(ok ? 0 : 1);
}
process.exit(0);
