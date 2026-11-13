/**
 * МОЖНО ЛИ ЗАПИСАТЬ EQ БРЕКЕТОМ (как микшер)?
 *
 * ═══ КОНТЕКСТ ═══
 *
 * Аудит 11 захватов (2512 исходящих кадров): MCC НИ РАЗУ не писал
 * в 0x91..0x94 и 0x9b. Устройство эти блоки только ПРИСЫЛАЕТ.
 *
 * Одиночная запись 0x91:03 не принимается (4 способа проверены).
 *
 * Но у микшера есть особый путь: брекет 0x11:0x20=1 ... 0x11:0x20=0
 * с пакетом кадров внутри. Без него микшер игнорируется (NOTES §139).
 * Возможно, для EQ нужно то же самое.
 *
 * ═══ ЧТО ПРОВЕРЯЕТ ═══
 *
 *   A. Брекет + одна полоса (0x91:03 = 3)
 *   B. Брекет + все 4 полосы IN1 (0x91:01, :03, :06, :08)
 *   C. Брекет + полоса + save 0x11:05
 *   D. Одиночный кадр, но ПОСЛЕ включения EQ через 0x9b:0f
 *
 * Читаем всегда в НОВОЙ сессии.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Всё откатывается.
 *
 * Запуск: node src/tools/prove-eq-bulk-write.js
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
  PP_BULK_BEGIN,
  PP_SAVE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

function open() {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  return { h, send };
}

async function prepare(send) {
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
}

async function readFresh(ms = 9000) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_ANNOUNCE, 1);
  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let j = 0; j < 128; j++) {
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
  } catch {
    /* ok */
  }
  return out;
}

/** Записать пачку кадров внутри брекета. */
async function writeBulk(frames, opts = {}) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(300);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(120);
  }
  await sleep(300);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(400);
  if (opts.save) {
    send(0x11, PP_SAVE, 1);
    await sleep(1200);
  }
  await sleep(600);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('ЗАПИСЬ EQ БРЕКЕТОМ — 4 СПОСОБА');
  console.log('='.repeat(70));

  const base = await readFresh(6000);
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);
  if (jack === 1 && mute0 !== 1) {
    await writeBulk([[0x64, 0x04, 1]]);
    if ((await readFresh(6000)).get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  заглушено');
  }

  const s0 = await readFresh();
  const orig = { b1: s0.get('91:01'), g1: s0.get('91:03'), eq: s0.get('9b:0f') };
  console.log('\nисходное:');
  console.log(`  0x91:01 enable1 = ${orig.b1}`);
  console.log(`  0x91:03 gain1   = ${orig.g1}`);
  console.log(`  0x9b:0f EQ      = ${orig.eq}`);

  const results = [];

  const check = async (label, probeAddr, expected) => {
    await sleep(1000);
    const after = await readFresh();
    const got = after.get(probeAddr);
    const ok = got === expected;
    console.log(`  ${label.padEnd(42)} ${probeAddr} -> ${got}  ${ok ? 'ПРИНЯТО' : '-'}`);
    results.push({ label, ok, got, expected });
    return ok;
  };

  // ─── A: брекет + одна полоса ───
  console.log('\n' + '-'.repeat(70));
  console.log('A: брекет + 0x91:03 = 3');
  console.log('-'.repeat(70));
  await writeBulk([[0x91, 0x03, 3]]);
  await check('A брекет + gain', '91:03', 3);

  // ─── B: брекет + все полосы IN1 ───
  console.log('\n' + '-'.repeat(70));
  console.log('B: брекет + все 4 полосы IN1 (enable + gain)');
  console.log('-'.repeat(70));
  await writeBulk([
    [0x91, 0x01, 1],
    [0x91, 0x03, 3],
    [0x91, 0x06, 1],
    [0x91, 0x08, 2],
  ]);
  await check('B все полосы + gain', '91:03', 3);

  // ─── C: брекет + полоса + SAVE ───
  console.log('\n' + '-'.repeat(70));
  console.log('C: брекет + полоса + save 0x11:05');
  console.log('-'.repeat(70));
  await writeBulk([[0x91, 0x03, 3]], { save: true });
  await check('C брекет + save', '91:03', 3);

  // ─── D: сначала EQ switch, потом полоса ───
  console.log('\n' + '-'.repeat(70));
  console.log('D: сначала 0x9b:0f = 1, потом 0x91:03 = 3 (в одном брекете)');
  console.log('-'.repeat(70));
  await writeBulk([
    [0x9b, 0x0f, 1],
    [0x91, 0x03, 3],
  ]);
  await check('D switch+gain', '91:03', 3);

  // откат
  console.log('\nоткатываю…');
  await writeBulk([
    [0x91, 0x03, orig.g1 ?? 0],
    [0x91, 0x01, orig.b1 ?? 0],
    [0x9b, 0x0f, orig.eq ?? 0],
  ]);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const any = results.filter((r) => r.ok);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(42)} ${r.ok ? 'РАБОТАЕТ' : 'не работает'}`);
  }
  console.log('');
  if (any.length) {
    console.log(`  Работает: ${any.map((r) => r.label).join(', ')}`);
  } else {
    console.log('  НИ ОДИН способ не записал EQ.');
    console.log('  Вместе с аудитом захватов (MCC ни разу не писал в EQ)');
    console.log('  это значит: EQ через HID НЕ УПРАВЛЯЕТСЯ. Только чтение.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
