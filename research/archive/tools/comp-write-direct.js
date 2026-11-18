/**
 * КОМПРЕССОР ЧЕРЕЗ HID: ПИШЕТСЯ ЛИ НАПРЯМУЮ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * §123 утверждает, что компрессор пишется 8/8, но тот замер делался
 * со снимком 7 секунд — а мы теперь знаем, что EQ приходит только
 * на первый announce сессии. Значит проверка была ненадёжной.
 *
 * Проверяем заново по правильному протоколу:
 *   - MCC закрыт;
 *   - снимок «до» и «после» — РАЗНЫЕ сессии;
 *   - значение считается принятым только если видно в новой сессии.
 *
 * ═══ АДРЕСА ═══
 *
 *   0x46:0x01 = Switch (вкл/выкл)
 *   0x46:0x02 = Threshold, дБ (-36..0)
 *   0x46:0x03 = Ratio x10 (4.0 -> 40)
 *   0x46:0x04 = Attack, мс (1..500)
 *   0x46:0x05 = Release, мс (1..601)
 *   0x46:0x06 = Gain (makeup)
 *   0x46:0x07 = Gain auto
 *   0x46:0x08 = Mix (0..100)
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняется по одному полю в безопасных пределах и возвращается.
 * Компрессор влияет на звук, но наушники и OTG отключены — проверяется.
 *
 * Запуск: node src/tools/comp-write-direct.js
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

async function freshSnapshot(ms = 18000) {
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

async function writeOne(pp, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x46, pp, value);
  await sleep(1200);
  try {
    h.close();
  } catch { /* ok */ }
}

async function main() {
  console.log('Снимок «до»…');
  const before = await freshSnapshot();

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }
  const compCount = [...before.keys()].filter((k) => /^46:/.test(k)).length;
  console.log(`  тегов=${before.size}, компрессор=${compCount}\n`);
  if (compCount === 0) {
    console.log('Компрессор не пришёл — проверять нечего.');
    process.exit(3);
  }

  const tests = [
    { name: 'Threshold', p: 0x02, key: '46:02', pick: (v) => (v === -20 ? -24 : -20) },
    { name: 'Ratio', p: 0x03, key: '46:03', pick: (v) => (v === 40 ? 60 : 40) },
    { name: 'Attack', p: 0x04, key: '46:04', pick: (v) => (v === 10 ? 20 : 10) },
    { name: 'Release', p: 0x05, key: '46:05', pick: (v) => (v === 200 ? 300 : 200) },
    { name: 'Mix', p: 0x08, key: '46:08', pick: (v) => (v === 100 ? 90 : 100) },
  ];

  const results = [];

  for (const t of tests) {
    const orig = before.get(t.key);
    if (orig === undefined) {
      console.log(`${t.name.padEnd(12)} тег ${t.key} не пришёл — пропуск`);
      results.push({ name: t.name, ok: false, reason: 'тег не пришёл' });
      continue;
    }
    const target = t.pick(orig);

    await writeOne(t.p, target);
    await sleep(1500);
    const after = await freshSnapshot();
    const got = after.get(t.key);
    const ok = got === target;

    console.log(`${t.name.padEnd(12)} 0x${t.key}: ${String(orig).padStart(5)} -> `
      + `${String(target).padStart(5)} -> ${String(got ?? '—').padStart(5)}  `
      + `${ok ? 'ПРИНЯТО' : 'нет'}`);
    results.push({ name: t.name, ok, orig, target, got });

    if (ok) {
      await writeOne(t.p, orig);
      await sleep(1200);
      const back = await freshSnapshot();
      console.log(`${''.padEnd(12)} откат: ${back.get(t.key) === orig ? 'ОК' : 'ПРОВЕРЬ'}`);
    }
  }

  console.log('\n' + '='.repeat(56));
  const passed = results.filter((r) => r.ok).length;
  console.log(`ИТОГ: ${passed} из ${tests.length}`);
  if (passed === tests.length) {
    console.log('Компрессор пишется через HID напрямую — UI не нужен.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
