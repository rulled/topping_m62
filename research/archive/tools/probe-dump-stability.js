/**
 * СТАБИЛЬНОСТЬ ДАМПА: какие семейства приходят в каждой сессии.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `probe-presets.js` дал разные результаты в трёх прогонах:
 * 10 изменений, 1 изменение, 0 изменений. Одна из причин — состав
 * дампа плавает: какие-то семейства приходят не в каждой сессии.
 *
 * Если это так, метод «снимок до / снимок после» ненадёжен для
 * медленных блоков: «тег пропал» может означать «не пришёл в этот
 * раз», а не «устройство его потеряло».
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Пять сессий подряд. Для каждой — набор семейств и сколько тегов
 * в каждом. Показывает, какие семейства появляются нестабильно.
 *
 * Запуск: node src/tools/probe-dump-stability.js
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
const SESSIONS = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 15000) {
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
  return out;
}

function families(map) {
  const out = new Map();
  for (const k of map.keys()) {
    const f = k.slice(0, 2);
    out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

async function main() {
  const runs = [];
  for (let i = 1; i <= SESSIONS; i++) {
    const s = await snap();
    const fam = families(s);
    runs.push({ i, total: s.size, fam, map: s });
    console.log(`сессия ${i}: ${s.size} тегов, ${fam.size} семейств`);
    await sleep(2500);
  }

  // все семейства, что встречались
  const allFam = new Set();
  for (const r of runs) for (const f of r.fam.keys()) allFam.add(f);

  console.log('\n' + '='.repeat(66));
  console.log('ТЕГОВ ПО СЕМЕЙСТВАМ В КАЖДОЙ СЕССИИ');
  console.log('='.repeat(66));
  const header = 'сем   ' + runs.map((r) => `с${r.i}`.padStart(4)).join('');
  console.log(header);
  console.log('-'.repeat(66));

  const unstableFam = [];
  for (const f of [...allFam].sort()) {
    const counts = runs.map((r) => r.fam.get(f) ?? 0);
    const same = counts.every((c) => c === counts[0]);
    const mark = same ? ' ' : '~';
    console.log(`${mark}0x${f}  ` + counts.map((c) => String(c).padStart(4)).join(''));
    if (!same) unstableFam.push({ fam: f, counts });
  }

  // теги, которые пропадали в какой-то сессии
  const allKeys = new Set();
  for (const r of runs) for (const k of r.map.keys()) allKeys.add(k);
  const missing = [];
  for (const k of allKeys) {
    const present = runs.map((r) => r.map.has(k));
    if (!present.every(Boolean)) {
      missing.push({ key: k, present: present.map((p) => (p ? 'Y' : '-')).join('') });
    }
  }

  console.log('\n' + '='.repeat(66));
  console.log('ИТОГ');
  console.log('='.repeat(66));
  const totals = runs.map((r) => r.total);
  console.log(`  всего тегов по сессиям: ${totals.join(', ')}`);
  const sameTotal = totals.every((t) => t === totals[0]);
  console.log(`  размер стабилен: ${sameTotal ? 'ДА' : 'НЕТ'}`);

  if (unstableFam.length) {
    console.log('\n  НЕСТАБИЛЬНЫЕ СЕМЕЙСТВА:');
    for (const u of unstableFam) {
      console.log(`    0x${u.fam}: ${u.counts.join(', ')}`);
    }
  } else {
    console.log('\n  Все семейства приходят в каждой сессии.');
  }

  if (missing.length) {
    console.log('\n  ТЕГИ, КОТОРЫЕ ПРОПАДАЛИ (Y = пришёл, - = нет):');
    for (const m of missing.sort((a, b) => a.key.localeCompare(b.key))) {
      console.log(`    ${m.key}  ${m.present}`);
    }
    console.log('\n  ЭТИ ТЕГИ НЕЛЬЗЯ ИСПОЛЬЗОВАТЬ как доказательство изменения:');
    console.log('  «пропал» может значить «не пришёл в этот раз».');
  } else {
    console.log('\n  Ни один тег не пропадал — снимок полностью воспроизводим.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
