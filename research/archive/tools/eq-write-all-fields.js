/**
 * EQ ВХОДОВ ЧЕРЕЗ HID: ВСЕ ПЯТЬ ПОЛЕЙ + ВТОРОЙ КАНАЛ.
 *
 * ═══ ЧТО УЖЕ ДОКАЗАНО ═══
 *
 * eq-write-definitive.js: `0x91:0x03` (gain полосы 1 IN1) 0 -> 3
 * прямой записью, проверено в НОВОЙ сессии, откат вернул 0.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ ═══
 *
 * Каждый тип поля отдельно, чтобы убедиться, что раскладка верна
 * и пишутся все пять, а не только gain:
 *
 *   канал 1 (блок 0x91):
 *     0x01 = вкл полосы 1       0/1
 *     0x02 = тип полосы 1       1 = peaking
 *     0x03 = gain полосы 1      дБ
 *     0x04 = частота полосы 1   Гц
 *     0x05 = Q полосы 1         x10000
 *     0x06..0x0a = то же для полосы 2
 *
 *   канал 2 (блок 0x93) — проверить одно поле, чтобы подтвердить,
 *     что 0x93/0x94 это второй канал, а не второй вход того же.
 *
 * ═══ ПРАВИЛА ИЗМЕРЕНИЯ (выведены 2026-11-10) ═══
 *
 *   1. EQ приходит ТОЛЬКО на первый announce сессии. Поэтому
 *      «снимок до» и «снимок после» — РАЗНЫЕ сессии, всегда.
 *   2. MCC должен быть закрыт.
 *   3. Значение считается принятым, только если видно в новой сессии.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется по одному полю и возвращается назад. Gain в пределах
 * -3..+3 дБ, частота и Q не трогаются в крайности. Наушники и OTG
 * проверяются: должны быть отключены.
 *
 * Запуск: node src/tools/eq-write-all-fields.js
 */

import HID from 'node-hid';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

/** Свежая сессия: снимок полного дампа. EQ приходит на первый announce. */
async function freshSnapshot(ms = 20000) {
  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch { /* ok */ }
  return out;
}

/** Пишет одно значение в отдельной короткой сессии. */
async function writeOne(tt, pp, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(tt, pp, value);
  await sleep(1200);
  try {
    h.close();
  } catch { /* ok */ }
}

async function main() {
  console.log('Снимок «до» (свежая сессия)…');
  const before = await freshSnapshot();

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }
  const eqCount = [...before.keys()].filter((k) => /^9[1-4]:/.test(k)).length;
  console.log(`  тегов=${before.size}, EQ-входов=${eqCount}\n`);

  if (eqCount === 0) {
    console.log('EQ не пришёл даже в свежей сессии — проверять нечего.');
    process.exit(3);
  }

  /**
   * Поля для проверки.
   * target/prop задают адрес, key — как читать, pick — новое значение.
   */
  const tests = [
    { name: 'вкл полосы 1', g: 0x91, p: 0x01, key: '91:01', pick: (v) => (v === 1 ? 0 : 1) },
    { name: 'тип полосы 1', g: 0x91, p: 0x02, key: '91:02', pick: (v) => (v === 2 ? 1 : 2) },
    { name: 'gain полосы 1', g: 0x91, p: 0x03, key: '91:03', pick: (v) => (v === 3 ? -3 : 3) },
    { name: 'частота полосы 1', g: 0x91, p: 0x04, key: '91:04', pick: (v) => (v === 1000 ? 632 : 1000) },
    { name: 'Q полосы 1', g: 0x91, p: 0x05, key: '91:05', pick: (v) => (v === 10000 ? 7000 : 10000) },
    { name: 'gain полосы 2', g: 0x91, p: 0x08, key: '91:08', pick: (v) => (v === 2 ? -2 : 2) },
    { name: 'gain канала 2 (0x93)', g: 0x93, p: 0x03, key: '93:03', pick: (v) => (v === 2 ? -2 : 2) },
  ];

  const results = [];

  for (const t of tests) {
    const orig = before.get(t.key);
    if (orig === undefined) {
      console.log(`${t.name.padEnd(24)} тег ${t.key} не пришёл — пропуск`);
      results.push({ name: t.name, ok: false, reason: 'тег не пришёл' });
      continue;
    }
    const target = t.pick(orig);

    await writeOne(t.g, t.p, target);
    await sleep(1500);

    const after = await freshSnapshot();
    const got = after.get(t.key);
    const ok = got === target;

    console.log(`${t.name.padEnd(24)} 0x${t.key}: ${String(orig).padStart(6)} -> `
      + `${String(target).padStart(6)} -> ${String(got ?? '—').padStart(6)}  `
      + `${ok ? 'ПРИНЯТО' : 'нет'}`);
    results.push({ name: t.name, ok, orig, target, got });

    if (ok) {
      await writeOne(t.g, t.p, orig);
      await sleep(1200);
      const back = await freshSnapshot();
      const restored = back.get(t.key) === orig;
      console.log(`${''.padEnd(24)} откат: ${restored ? 'ОК' : 'ПРОВЕРЬ'}`);
      if (!restored) results.push({ name: `${t.name} (откат)`, ok: false });
    }
  }

  console.log('\n' + '='.repeat(62));
  console.log('ИТОГ');
  console.log('='.repeat(62));
  const passed = results.filter((r) => r.ok).length;
  console.log(`  прошло: ${passed} из ${tests.length}`);
  for (const r of results) {
    if (!r.ok) console.log(`  ПРОВАЛ: ${r.name}${r.reason ? ` (${r.reason})` : ''}`);
  }
  if (passed === tests.length) {
    console.log('\n  Все поля EQ входов пишутся через HID напрямую.');
    console.log('  Можно переводить бекенд с UI на HID.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
