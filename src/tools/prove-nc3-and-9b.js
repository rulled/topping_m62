/**
 * NC3 И 0x9b:12/13 — ЧТО ЭТО.
 *
 * ═══ NC3 ═══
 *
 * Из дизассемблера MCC известны коды типов шумоподавления:
 *   bypass = 0, NC1 = 15, NC2 = 30, NC3 = 45
 *
 * NC1 и NC2 проверены на устройстве. NC3 — нет.
 *
 * Проверяем: пишем 0x44:0x07 = 45 и смотрим, что приходит обратно.
 * Если тип меняется на 45 — NC3 существует и доступен.
 *
 * ═══ 0x9b:0x12 / 0x9b:0x13 ═══
 *
 * Теги есть в потоке (0x9b:12 = 0, 0x9b:13 = 0), но смысл неизвестен.
 * Рядом лежат:
 *   0x9b:0d / 0x9b:0e — EQ IN1/IN2 gain
 *   0x9b:0f / 0x9b:10 — EQ IN1/IN2 switch
 *
 * Гипотеза: 0x9b:12/13 — второй параметр EQ, возможно «mix» или
 * «output level» для каждого входа.
 *
 * Проверяем: пишем разные значения и смотрим, читаются ли обратно.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * NC влияет на звук, но наушники и OTG проверяются. Значения
 * откатываются. 0x9b:12/13 — пробуем малые значения.
 *
 * Запуск: node src/tools/prove-nc3-and-9b.js
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
const NC_CODES = { Bypass: 0, NC1: 15, NC2: 30, NC3: 45 };
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
    while (Date.now() - t0 < 16000) {
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
  console.log(`базовый снимок: ${s0.size} тегов`);

  const hp = s0.get('64:06');
  const otg = s0.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён`);
    process.exit(2);
  }

  // ═══ NC3 ═══
  console.log('\n' + '='.repeat(60));
  console.log('NC: ПРОВЕРКА ВСЕХ ЧЕТЫРЁХ КОДОВ');
  console.log('='.repeat(60));

  const ncOrig = { level: s0.get('44:06'), type: s0.get('44:07') };
  console.log(`исходно: уровень=${ncOrig.level} тип=${ncOrig.type}`);

  const ncResults = [];
  for (const [name, code] of Object.entries(NC_CODES)) {
    if (code === 0) continue; // bypass не трогаем
    console.log(`\nпишу тип NC = ${code} (${name})…`);
    await cmd(0x44, 0x07, code);
    await sleep(1000);
    const after = await fullSnap();
    const got = after.get('44:07');
    const ok = got === code;
    console.log(`  0x44:07: ${ncOrig.type} -> ${code} -> ${got}  ${ok ? 'ПРИНЯТО' : 'нет'}`);
    ncResults.push({ name, code, got, ok });
  }

  // вернуть исходный тип
  if (ncOrig.type !== undefined) {
    console.log(`\nвозвращаю тип NC = ${ncOrig.type}`);
    await cmd(0x44, 0x07, ncOrig.type);
  }

  // ═══ 0x9b:12 / 0x9b:13 ═══
  console.log('\n' + '='.repeat(60));
  console.log('0x9b:0x12 / 0x9b:0x13 — ЧТО ЭТО');
  console.log('='.repeat(60));

  const bOrig = { p12: s0.get('9b:12'), p13: s0.get('9b:13') };
  console.log(`исходно: 0x9b:12=${bOrig.p12}  0x9b:13=${bOrig.p13}`);
  console.log('соседние (известные):');
  console.log(`  0x9b:0d EQ IN1 gain = ${s0.get('9b:0d')}`);
  console.log(`  0x9b:0e EQ IN2 gain = ${s0.get('9b:0e')}`);
  console.log(`  0x9b:0f EQ IN1 switch = ${s0.get('9b:0f')}`);
  console.log(`  0x9b:10 EQ IN2 switch = ${s0.get('9b:10')}`);

  const tests = [10, 50, 100];
  const bResults = [];
  for (const val of tests) {
    console.log(`\nпишу 0x9b:12 = ${val}…`);
    await cmd(0x9b, 0x12, val);
    await sleep(1000);
    const after = await fullSnap();
    const got = after.get('9b:12');
    const ok = got === val;
    console.log(`  0x9b:12: ${bOrig.p12} -> ${val} -> ${got}  ${ok ? 'ПРИНЯТО' : 'не читается'}`);
    bResults.push({ val, got, ok });
  }

  // вернуть
  if (bOrig.p12 !== undefined) {
    await cmd(0x9b, 0x12, bOrig.p12);
    console.log(`\nвозвращаю 0x9b:12 = ${bOrig.p12}`);
  }

  await sleep(1500);
  const fin = await fullSnap();

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));

  console.log('\n  NC:');
  for (const r of ncResults) {
    console.log(`    ${r.ok ? '+' : '-'} ${r.name} (код ${r.code}) — ${r.ok ? 'работает' : 'не принят'}`);
  }

  console.log('\n  0x9b:12:');
  const anyB = bResults.some((r) => r.ok);
  if (anyB) {
    console.log('    пишется и читается обратно, но смысл не установлен');
    console.log(`    значения: ${bResults.map((r) => r.val).join(', ')}`);
  } else {
    console.log('    не читается обратно — только запись');
  }

  console.log(`\n  состояние восстановлено: NC тип=${fin.get('44:07')} 0x9b:12=${fin.get('9b:12')}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
