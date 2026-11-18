/**
 * 0x9b:0x12 — ЧТО ЭТО И КАКОЙ ДИАПАЗОН.
 *
 * ═══ ЧТО НАБЛЮДАЛОСЬ ═══
 *
 *   пишу 10  -> читается 0    (не принято)
 *   пишу 50  -> читается 50   (принято)
 *   пишу 100 -> читается 50   (не принято, осталось 50)
 *
 * Похоже на квантование или узкий диапазон. Но 10 не принялось,
 * а 50 принялось — странно, если диапазон широкий.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 * A. Это enum с фиксированным набором значений (например, тип).
 * B. Значение квантуется с шагом (например, кратно 25).
 * C. Это не параметр EQ, а что-то другое, с диапазоном 0..50.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Перебирает значения и записывает, что реально читается обратно.
 * Так видно и диапазон, и шаг квантования.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * 0x9b — семейство EQ. Значения небольшие. Всё возвращается в 0.
 * Наушники и OTG проверяются.
 *
 * Запуск: node src/tools/probe-9b12-range.js
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

async function fullSnap(min = 100, attempts = 3) {
  let best = new Map();
  for (let i = 1; i <= attempts; i++) {
    const dev = findDev();
    if (!dev) return best;
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
    while (Date.now() - t0 < 15000) {
      for (let j = 0; j < 128; j++) {
        let buf;
        try { buf = h.readTimeout(1); } catch { break; }
        if (!buf || !buf.length) break;
        if (isIdle(buf)) continue;
        const f = parseReport(buf);
        if (!f) continue;
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
      if (Date.now() - lk >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lk = Date.now(); }
      await sleep(8);
    }
    try { h.close(); } catch { /* ok */ }
    if (out.size > best.size) best = out;
    if (out.size >= min) return best;
    await sleep(2000);
  }
  return best;
}

async function cmd(tt, pp, value) {
  const dev = findDev();
  if (!dev) throw new Error('устройство не найдено');
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(tt, pp, value);
  await sleep(1200);
  try { h.close(); } catch { /* ok */ }
}

async function main() {
  const s0 = await fullSnap();
  console.log(`базовый: ${s0.size} тегов`);
  console.log(`0x9b:12 = ${s0.get('9b:12')}   0x9b:13 = ${s0.get('9b:13')}`);

  const hp = s0.get('64:06');
  const otg = s0.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log('ОСТАНОВ: джек подключён');
    process.exit(2);
  }

  const values = [0, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 200, 500];
  console.log('\nперебор 0x9b:12:\n');
  console.log('  пишем  ->  читаем  вердикт');
  console.log('  ' + '-'.repeat(38));

  const results = [];
  for (const v of values) {
    await cmd(0x9b, 0x12, v);
    await sleep(600);
    const s = await fullSnap();
    const got = s.get('9b:12');
    const accepted = got === v;
    results.push({ v, got, accepted });
    console.log(`  ${String(v).padStart(5)}  ->  ${String(got ?? '—').padStart(6)}  ${accepted ? 'ПРИНЯТО' : (got === 0 ? 'стало 0' : 'искажено')}`);
  }

  // возврат
  await cmd(0x9b, 0x12, 0);
  await sleep(800);
  const fin = await fullSnap();
  console.log(`\nвозвращено: 0x9b:12 = ${fin.get('9b:12')}`);

  // --- анализ ---
  const accepted = results.filter((r) => r.accepted).map((r) => r.v);
  const rejected = results.filter((r) => !r.accepted);

  console.log('\n' + '='.repeat(56));
  console.log('АНАЛИЗ');
  console.log('='.repeat(56));
  console.log(`  принято значений: ${accepted.length} — ${accepted.join(', ') || 'нет'}`);
  console.log(`  отвергнуто: ${rejected.length}`);

  if (rejected.length) {
    console.log('\n  отвергнутые (написали -> получили):');
    for (const r of rejected) {
      console.log(`    ${r.v} -> ${r.got}`);
    }
  }

  if (accepted.length) {
    const min = Math.min(...accepted);
    const max = Math.max(...accepted);
    console.log(`\n  диапазон принятых: ${min}..${max}`);

    // шаг квантования
    if (accepted.length > 1) {
      const sorted = [...accepted].sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i] - sorted[i - 1]);
      const uniq = [...new Set(gaps)].sort((a, b) => a - b);
      console.log(`  шаги между принятыми: ${uniq.join(', ')}`);
    }
  }

  console.log(`
  0x9b:0x0d и 0x9b:0x0e (gain EQ IN1/IN2) в этом дампе не пришли —
  возможно, они появляются только при включённом EQ (0x9b:0f/10 = 1).
  Если 0x9b:12/13 ведут себя как gain — это дублирующие теги.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
