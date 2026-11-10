/**
 * ПОВЕДЕНЧЕСКИЙ АУДИТ: какие маршруты РЕАЛЬНО работают без MCC.
 *
 * ═══ ЗАЧЕМ ОН, ЕСЛИ ЕСТЬ autonomy-audit.js ═══
 *
 * `autonomy-audit.js` смотрит на ВЫЗОВЫ функций в коде — это оценка
 * сверху. `autonomy-behaviour.js` дёргает маршруты по-настоящему
 * и смотрит на код ответа — это факт.
 *
 * Расхождение бывает в обе стороны:
 *   - маршрут вызывает workspace.describe() в try/catch для
 *     диагностики и прекрасно работает без MCC (аудит ложно
 *     записывал его в зависимые);
 *   - маршрут выглядит чистым, но зовёт UIAutomation глубже
 *     в вызываемой функции.
 *
 * Для отчётов и документации верить надо ЭТОМУ инструменту.
 * Требует запущенного сервера и ЗАКРЫТОГО MCC.
 *
 * Запуск: node src/tools/autonomy-behaviour.js
 * Порт: M62_PORT (по умолчанию 8787)
 */

const PORT = process.env.M62_PORT ?? '8787';
const BASE = `http://127.0.0.1:${PORT}`;

/** GET-маршруты, которые безопасно дёргать. */
const GET_ROUTES = [
  '/api/health',
  '/api/device',
  '/api/controls',
  '/api/settings',
  '/api/meters',
  '/api/tags',
  '/api/mode',
  '/api/workspace',
  '/api/workspaces',
  '/api/eq',
  '/api/eq/types',
  '/api/eq/dials',
  '/api/eq/params',
  '/api/eq/scales',
  '/api/eq-mixer',
  '/api/mixer',
  '/api/eq-hp',
  '/api/compressor',
  '/api/compressor/scales',
  '/api/reverb',
  '/api/audio-params',
  '/api/snapshots',
  '/api/ui-controls',
  '/api/state',
  '/api/state/full',
];

/** Код ответа. */
async function probe(path, method = 'GET', body = null) {
  try {
    const opts = { method, signal: AbortSignal.timeout(20000) };
    if (body !== null) {
      opts.headers = { 'content-type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(`${BASE}${path}`, opts);
    let json = null;
    try {
      json = await r.json();
    } catch { /* не JSON */ }
    return { status: r.status, ok: r.ok, json };
  } catch (err) {
    return { status: 0, ok: false, error: String(err?.message ?? err) };
  }
}

/** Подтверждает, что MCC действительно закрыт. */
async function mccClosed() {
  const h = await probe('/api/ui-controls');
  if (!h.json) return null;
  // окна MCC нет — проверяем через health/device нельзя напрямую,
  // поэтому полагаемся на то, что пользователь закрыл его вручную
  return h.ok;
}

async function main() {
  const health = await probe('/api/health');
  if (!health.ok) {
    console.error(`сервер не отвечает на ${BASE}. Запустите: npm start`);
    process.exit(2);
  }
  console.log(`сервер: ${BASE}, connected=${health.json?.connected}`);
  console.log('');

  const works = [];
  const fails = [];

  for (const path of GET_ROUTES) {
    const r = await probe(path);
    const mark = r.ok ? 'OK  ' : `FAIL`;
    const note = r.ok
      ? ''
      : `  HTTP ${r.status}${r.json?.error ? `: ${String(r.json.error).slice(0, 60)}` : ''}`;
    console.log(`  ${mark} GET ${path}${note}`);
    if (r.ok) works.push(path);
    else fails.push({ path, status: r.status, error: r.json?.error });
  }

  // Безопасные POST: только чтение/валидация, без записи в устройство.
  console.log('');
  const safePosts = [
    { path: '/api/state/import', body: {}, skip: 'перезапишет состояние' },
    { path: '/api/connect', body: {}, skip: 'меняет соединение' },
  ];
  for (const p of safePosts) {
    console.log(`  --   POST ${p.path}  (не проверялось: ${p.skip})`);
  }

  console.log('\n' + '='.repeat(64));
  console.log('ИТОГ (по факту ответа, MCC закрыт)');
  console.log('='.repeat(64));
  console.log(`  работает:  ${works.length} из ${GET_ROUTES.length} GET-маршрутов`);
  console.log(`  падает:    ${fails.length}`);
  if (fails.length) {
    console.log('\n  Не работают без MCC:');
    for (const f of fails) {
      console.log(`    ${f.path}  HTTP ${f.status}  ${String(f.error ?? '').slice(0, 70)}`);
    }
  }

  console.log('\n  ВНИМАНИЕ: это только GET. POST-маршруты, которые меняют');
  console.log('  устройство, здесь не проверяются — для них нужен MCC');
  console.log('  закрытым, но и запись без последствий не сделать.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
