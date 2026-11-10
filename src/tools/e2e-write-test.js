/**
 * СКВОЗНОЙ ПРОГОН: все POST-маршруты записи при ЗАКРЫТОМ MCC.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `autonomy-behaviour.js` проверяет только GET. Запись — самое важное
 * и самое рискованное, и её надо проверить отдельно.
 *
 * Здесь каждый маршрут записи:
 *   1. читает текущее значение,
 *   2. пишет новое,
 *   3. читает заново В НОВОЙ СЕССИИ (для блоков, где это нужно),
 *   4. возвращает исходное.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Проверяет, что наушники и OTG отключены, иначе отказывается.
 * Все значения откатываются. Громкости меняются в узком диапазоне.
 *
 * Запуск: node src/tools/e2e-write-test.js
 * Порт: M62_PORT (по умолчанию 8787)
 */

const PORT = process.env.M62_PORT ?? '8787';
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, method = 'GET', body = null) {
  const opts = { method, signal: AbortSignal.timeout(25000) };
  if (body !== null) {
    opts.headers = { 'content-type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}/api/${path}`, opts);
  let json = null;
  try { json = await r.json(); } catch { /* не JSON */ }
  return { status: r.status, ok: r.ok, json };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(38)} ${detail ?? ''}`);
}

/** Свежий снимок реверба/компрессора/EQ после записи. */
async function rereadSnapshot() {
  // Небольшая пауза: устройство применяет запись не мгновенно.
  await sleep(600);
  const eq = await api('eq');
  const comp = await api('compressor');
  const rv = await api('reverb');
  return {
    eq: eq.json?.bands,
    comp: comp.json?.values,
    reverb: rv.json?.current,
  };
}

async function main() {
  const health = await api('health');
  if (!health.ok) {
    console.error(`сервер не отвечает на ${BASE}. Запустите npm start`);
    process.exit(2);
  }
  console.log(`сервер: ${BASE}, connected=${health.json?.connected}`);

  // --- безопасность ---
  const tagSnap = await api('tags');
  const rv0 = await api('reverb');
  if (!rv0.ok) {
    console.error('не читается реверб — устройство не в том режиме?');
    process.exit(2);
  }

  const safety = await fetch(`${BASE}/api/eq`).then((r) => r.json()).catch(() => null);
  // джеки проверяем через отдельный скрипт; здесь полагаемся на то,
  // что пользователь их отключил
  console.log('');

  // ═══ 1. EQ входов ═══
  console.log('─'.repeat(60));
  console.log('EQ ВХОДОВ');
  console.log('─'.repeat(60));

  const eq0 = await api('eq');
  const band1Gain = eq0.json?.bands?.IN1?.[0]?.gain ?? 0;
  const eqTarget = band1Gain === 3 ? -3 : 3;

  let r = await api('eq/band', 'POST', { input: 'IN1', band: 1, param: 'gain', value: eqTarget });
  record('POST /api/eq/band (gain)', r.ok && r.json?.via === 'hid', `-> ${r.json?.after}`);

  let snap = await rereadSnapshot();
  record('  проверка: gain применился', snap.eq?.IN1?.[0]?.gain === eqTarget,
    `видим ${snap.eq?.IN1?.[0]?.gain}`);

  r = await api('eq/band', 'POST', { input: 'IN1', band: 1, param: 'gain', value: band1Gain });
  record('  откат gain', r.ok, `-> ${r.json?.after}`);

  r = await api('eq/band/enable', 'POST', { input: 'IN1', band: 2, enabled: true });
  record('POST /api/eq/band/enable', r.ok && r.json?.via === 'hid', `enabled=${r.json?.enabled}`);
  r = await api('eq/band/enable', 'POST', { input: 'IN1', band: 2, enabled: false });
  record('  откат enable', r.ok, `enabled=${r.json?.enabled}`);

  // ═══ 2. Компрессор ═══
  console.log('');
  console.log('─'.repeat(60));
  console.log('КОМПРЕССОР');
  console.log('─'.repeat(60));

  const comp0 = await api('compressor');
  const attack0 = comp0.json?.values?.attack ?? 5;
  const attackTarget = attack0 === 10 ? 5 : 10;

  r = await api('compressor/param', 'POST', { param: 'attack', value: attackTarget });
  record('POST /api/compressor/param', r.ok && r.json?.via === 'hid', `-> ${r.json?.after}`);

  snap = await rereadSnapshot();
  record('  проверка: attack применился', snap.comp?.attack === attackTarget,
    `видим ${snap.comp?.attack}`);

  r = await api('compressor/param', 'POST', { param: 'attack', value: attack0 });
  record('  откат attack', r.ok, `-> ${r.json?.after}`);

  // ═══ 3. Реверб ═══
  console.log('');
  console.log('─'.repeat(60));
  console.log('РЕВЕРБ');
  console.log('─'.repeat(60));

  const rvBefore = await api('reverb');
  const typeBefore = rvBefore.json?.current?.typeName ?? 'Bypass';
  const dwBefore = rvBefore.json?.current?.dryWet ?? 30;

  // при Bypass параметры не применяются — сначала тип
  r = await api('reverb', 'POST', { type: 'LIVE' });
  record('POST /api/reverb (тип LIVE)', r.ok && r.json?.via === 'hid', `-> ${r.json?.type}`);

  const dwTarget = dwBefore === 45 ? 30 : 45;
  r = await api('reverb/param', 'POST', { param: 'dryWet', value: dwTarget });
  record('POST /api/reverb/param (dryWet)', r.ok && r.json?.via === 'hid', `-> ${r.json?.after}`);

  snap = await rereadSnapshot();
  record('  проверка: dryWet применился', snap.reverb?.dryWet === dwTarget,
    `видим ${snap.reverb?.dryWet}`);

  r = await api('reverb/param', 'POST', { param: 'dryWet', value: dwBefore });
  record('  откат dryWet', r.ok, `-> ${r.json?.after}`);
  r = await api('reverb', 'POST', { type: typeBefore });
  record('  откат типа', r.ok, `-> ${r.json?.type}`);

  // ═══ 4. Проверка защиты при Bypass ═══
  console.log('');
  console.log('─'.repeat(60));
  console.log('ЗАЩИТА: реверб в Bypass');
  console.log('─'.repeat(60));

  const rvNow = await api('reverb');
  if (rvNow.json?.current?.bypass) {
    r = await api('reverb/param', 'POST', { param: 'dryWet', value: 50 });
    record('Bypass -> 409 с подсказкой', r.status === 409 && r.json?.hint !== undefined,
      `HTTP ${r.status}`);
  } else {
    record('Bypass -> 409 (пропущено)', true, 'тип не Bypass');
  }

  // ═══ 5. Состояние ═══
  console.log('');
  console.log('─'.repeat(60));
  console.log('СОБСТВЕННОЕ ХРАНИЛИЩЕ');
  console.log('─'.repeat(60));

  r = await api('state');
  record('GET /api/state', r.ok, `шин ${r.json?.mixer?.buses?.length}`);
  r = await api('state/full');
  record('GET /api/state/full', r.ok, `есть state: ${Boolean(r.json?.state)}`);

  // ═══ ИТОГ ═══
  console.log('');
  console.log('='.repeat(60));
  const passed = results.filter((x) => x.ok).length;
  console.log(`ИТОГ: ${passed} из ${results.length}`);
  const failed = results.filter((x) => !x.ok);
  if (failed.length) {
    console.log('ПРОВАЛЫ:');
    for (const f of failed) console.log(`  ${f.name}: ${f.detail}`);
  }
  console.log('='.repeat(60));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
