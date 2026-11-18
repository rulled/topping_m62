/**
 * КОНТРОЛЬНЫЙ ОПЫТ: насколько стабилен снимок БЕЗ команд.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `probe-presets.js` показал «сцена Chat: 0x44:0x0a пропал, Vocal:
 * появился». Но это может быть шумом, а не эффектом сцены: блоки
 * приходят не мгновенно и не всегда целиком.
 *
 * Правило проекта: любой результат требует контрольного опыта, где
 * то же самое измеряется БЕЗ воздействия.
 *
 * Здесь делаем три снимка подряд, НИЧЕГО не посылая, и смотрим,
 * какие теги «пропадают» и «появляются» сами по себе. Это шумовой
 * порог: всё, что попадает в него, нельзя считать эффектом команды.
 *
 * Запуск: node src/tools/probe-noise-floor.js
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

async function snap(ms = 16000) {
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

const METER_KEYS = new Set([
  '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02',
  '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01',
  '9b:0b',
]);

function diff(a, b) {
  const out = [];
  for (const [k, v] of b) {
    if (METER_KEYS.has(k)) continue;
    const was = a.get(k);
    if (was === undefined) out.push({ key: k, from: '(нет)', to: v, kind: 'появился' });
    else if (was !== v) out.push({ key: k, from: was, to: v, kind: 'изменился' });
  }
  for (const [k, v] of a) {
    if (METER_KEYS.has(k)) continue;
    if (!b.has(k)) out.push({ key: k, from: v, to: '(пропал)', kind: 'пропал' });
  }
  return out;
}

async function main() {
  console.log('ТРИ СНИМКА ПОДРЯД, КОМАНД НЕ ШЛЁМ\n');

  const s1 = await snap();
  console.log(`снимок 1: ${s1.size} тегов`);
  await sleep(3000);
  const s2 = await snap();
  console.log(`снимок 2: ${s2.size} тегов`);
  await sleep(3000);
  const s3 = await snap();
  console.log(`снимок 3: ${s3.size} тегов`);

  const d12 = diff(s1, s2);
  const d23 = diff(s2, s3);
  const d13 = diff(s1, s3);

  console.log('\n' + '='.repeat(60));
  console.log('ШУМ: ИЗМЕНЕНИЯ БЕЗ ВСЯКИХ КОМАНД');
  console.log('='.repeat(60));

  console.log(`\n1 -> 2: ${d12.length} отличий`);
  for (const d of d12) console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);

  console.log(`\n2 -> 3: ${d23.length} отличий`);
  for (const d of d23) console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);

  console.log(`\n1 -> 3: ${d13.length} отличий`);
  for (const d of d13) console.log(`  ${d.key}  ${d.from} -> ${d.to}  (${d.kind})`);

  // Собираем все ключи, которые хоть раз «мигнули»
  const unstable = new Set();
  for (const d of [...d12, ...d23, ...d13]) unstable.add(d.key);

  console.log('\n' + '='.repeat(60));
  console.log('ШУМОВОЙ ПОРОГ');
  console.log('='.repeat(60));
  if (!unstable.size) {
    console.log('  Снимок СТАБИЛЕН: ни один тег не мигнул без команд.');
    console.log('  Значит любые изменения после команды — реальный эффект.');
  } else {
    console.log(`  Нестабильные теги (${unstable.size}): ${[...unstable].sort().join(', ')}`);
    console.log('  Эти теги мигают сами по себе и НЕ годятся как доказательство.');
  }

  console.log(`\n  размер снимков: ${s1.size}, ${s2.size}, ${s3.size}`);
  if (s1.size !== s2.size || s2.size !== s3.size) {
    console.log('  РАЗМЕР ПЛАВАЕТ — блоки приходят не целиком.');
    console.log('  Отсутствие тега в снимке НЕ значит, что устройство его не имеет.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
