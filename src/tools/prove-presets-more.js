/**
 * ПРЕСЕТЫ: ЧТО ЕЩЁ ВХОДИТ — EQ, NC, FX-уровни.
 *
 * ═══ ЧТО УЖЕ ИЗВЕСТНО ═══
 *
 * `prove-presets-what.js` проверил четыре параметра:
 *
 *   реверб тип       восстанавливается
 *   реверб dryWet    восстанавливается
 *   громкость MIC-1  восстанавливается
 *   компрессор attack НЕ восстанавливается
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ ═══
 *
 * Те блоки, которые ЧИТАЮТСЯ из HID (значит проверка возможна):
 *
 *   EQ входов   0x91:03 gain, 0x91:04 freq
 *   EQ наушников 0xa1:03 gain        (только Prof)
 *   NC уровень  0x44:06
 *   NC тип      0x44:07
 *   FX уровни   0x44:01..05
 *
 * Микшер, loopback и ducking проверить нельзя — они не читаются.
 *
 * ═══ МЕТОД ═══
 *
 * Тот же, что дал результат: состояние A -> save -> состояние B ->
 * load -> сравнить с A.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Меняются громкость EQ, NC и FX-уровни в небольших пределах.
 * Всё возвращается. Наушники и OTG проверяются.
 *
 * Запуск: node src/tools/prove-presets-more.js
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
const PP_SAVE_PRESET = 0x08;
const PP_LOAD_PRESET = 0x0e;
const PRESET = 1;

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
    while (Date.now() - t0 < 17000) {
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
  console.log('снимок исходного…');
  const s0 = await fullSnap();
  console.log(`  ${s0.size} тегов`);

  const hp = s0.get('64:06');
  const otg = s0.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён`);
    process.exit(2);
  }

  // исходные значения — чтобы вернуть
  const orig = {
    eqGain: s0.get('91:03'),
    eqFreq: s0.get('91:04'),
    nc: s0.get('44:06'),
    ncType: s0.get('44:07'),
    fx1: s0.get('44:01'),
  };
  console.log(`  EQ gain=${orig.eqGain} freq=${orig.eqFreq} NC=${orig.nc} тип=${orig.ncType} FX1=${orig.fx1}`);

  // --- состояние A ---
  console.log('\nставлю состояние A…');
  await cmd(0x91, 0x03, 6);       // EQ gain +6
  await cmd(0x91, 0x04, 1000);    // EQ freq 1000
  await cmd(0x44, 0x06, 40);      // NC уровень 40
  await cmd(0x44, 0x01, -6);      // FX1 -6
  await sleep(2500);
  const sA = await fullSnap();
  console.log(`  EQ gain=${sA.get('91:03')} freq=${sA.get('91:04')} NC=${sA.get('44:06')} FX1=${sA.get('44:01')}`);

  // --- сохраняем ---
  console.log(`\nсохраняю пресет ${PRESET}…`);
  await cmd(0x11, PP_SAVE_PRESET, PRESET);
  await sleep(2000);

  // --- состояние B ---
  console.log('\nставлю состояние B (другие значения)…');
  await cmd(0x91, 0x03, -6);
  await cmd(0x91, 0x04, 250);
  await cmd(0x44, 0x06, 20);
  await cmd(0x44, 0x01, -20);
  await sleep(2500);
  const sB = await fullSnap();
  console.log(`  EQ gain=${sB.get('91:03')} freq=${sB.get('91:04')} NC=${sB.get('44:06')} FX1=${sB.get('44:01')}`);

  // --- загружаем ---
  console.log(`\nзагружаю пресет ${PRESET}…`);
  await cmd(0x11, PP_LOAD_PRESET, PRESET);
  await sleep(5000);
  const sL = await fullSnap();
  console.log(`  EQ gain=${sL.get('91:03')} freq=${sL.get('91:04')} NC=${sL.get('44:06')} FX1=${sL.get('44:01')}`);

  // --- сравнение ---
  const checks = [
    { name: 'EQ входов gain', key: '91:03', a: sA.get('91:03') },
    { name: 'EQ входов freq', key: '91:04', a: sA.get('91:04') },
    { name: 'NC уровень', key: '44:06', a: sA.get('44:06') },
    { name: 'NC тип', key: '44:07', a: sA.get('44:07') },
    { name: 'FX уровень IN1', key: '44:01', a: sA.get('44:01') },
  ];

  console.log('\n' + '='.repeat(66));
  console.log('ЧТО ВОССТАНОВИЛ ПРЕСЕТ');
  console.log('='.repeat(66));
  console.log(`  ${'параметр'.padEnd(20)} ${'A'.padStart(6)} ${'B'.padStart(6)} ${'после'.padStart(6)}  вердикт`);
  console.log(`  ${'-'.repeat(20)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)}  ${'-'.repeat(14)}`);

  let restored = 0;
  const results = [];
  for (const c of checks) {
    const bVal = sB.get(c.key);
    const lVal = sL.get(c.key);
    const ok = lVal === c.a;
    if (ok) restored += 1;
    results.push({ ...c, b: bVal, l: lVal, ok });
    console.log(`  ${c.name.padEnd(20)} ${String(c.a).padStart(6)} ${String(bVal).padStart(6)} ${String(lVal).padStart(6)}  ${ok ? 'ВОССТАНОВЛЕН' : 'нет'}`);
  }

  console.log(`\n  восстановлено: ${restored} из ${checks.length}`);

  // --- возврат ---
  console.log('\nвозвращаю исходные значения…');
  await cmd(0x91, 0x03, orig.eqGain ?? 0);
  await cmd(0x91, 0x04, orig.eqFreq ?? 632);
  await cmd(0x44, 0x06, orig.nc ?? 15);
  await cmd(0x44, 0x01, orig.fx1 ?? 0);
  await sleep(2000);
  const fin = await fullSnap();
  console.log(`  EQ gain=${fin.get('91:03')} freq=${fin.get('91:04')} NC=${fin.get('44:06')} FX1=${fin.get('44:01')}`);

  console.log('\n' + '='.repeat(66));
  console.log('ИТОГ');
  console.log('='.repeat(66));
  for (const r of results) {
    console.log(`  ${r.ok ? '+' : '-'} ${r.name}`);
  }
  console.log(`
  Вместе с прежним замером (реверб и громкости — да,
  компрессор — нет) это даёт полную картину того, что
  пресет хранит.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
