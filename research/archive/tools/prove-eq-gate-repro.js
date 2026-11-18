/**
 * ВОСПРОИЗВОДИМОСТЬ «СПОСОБА D»: гейт в том же брекете.
 *
 * ═══ ПРОТИВОРЕЧИЕ ═══
 *
 * prove-eq-bulk-write.js:
 *   A: брекет [0x91:03=3]                     -> 0   не принято
 *   B: брекет [4 полосы]                       -> 0   не принято
 *   C: брекет [0x91:03=3] + save               -> 0   не принято
 *   D: брекет [0x9b:0f=1, 0x91:03=3]           -> 3   ПРИНЯТО
 *
 * prove-eq-gate.js:
 *   шаг 1: брекет [0x9b:0f=1], читаю            -> 0
 *   шаг 2: ОДИНОЧНО [0x91:03=3]                 -> 0   не принято
 *
 * Разница: в D оба кадра были В ОДНОМ брекете. В gate — в разных
 * сессиях/брекетах. Гипотеза: устройство принимает запись EQ только
 * если в том же брекете первым идёт 0x9b:0f = 1.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Повторяет D ТРИ раза подряд, чтобы понять, воспроизводимо ли это,
 * и проверяет все поля полосы в одном брекете с гейтом.
 *
 * Если D повторится 3/3 — это настоящий рабочий протокол.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением, всё откатывается.
 *
 * Запуск: node src/tools/prove-eq-gate-repro.js
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

async function writeBulk(frames) {
  const { h, send } = open();
  await prepare(send);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(130);
  }
  await sleep(250);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(700);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('ВОСПРОИЗВОДИМОСТЬ СПОСОБА D');
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
  }

  const s0 = await readFresh();
  const orig = {
    sw: s0.get('9b:0f'),
    en1: s0.get('91:01'),
    ty1: s0.get('91:02'),
    g1: s0.get('91:03'),
    f1: s0.get('91:04'),
    q1: s0.get('91:05'),
  };
  console.log('\nисходное:');
  console.log(`  0x9b:0f=${orig.sw}  0x91:01=${orig.en1}  0x91:02=${orig.ty1}`);
  console.log(`  0x91:03=${orig.g1}  0x91:04=${orig.f1}  0x91:05=${orig.q1}`);

  // ─── повтор D три раза с разными значениями ───
  console.log('\n' + '-'.repeat(70));
  console.log('ПОВТОР D (брекет: 0x9b:0f=1 затем 0x91:03=N) — 3 раза');
  console.log('-'.repeat(70));
  const reps = [];
  for (const target of [3, 4, 5]) {
    console.log(`\nпопытка: 0x91:03 = ${target}`);
    await writeBulk([
      [0x9b, 0x0f, 1],
      [0x91, 0x03, target],
    ]);
    const r = await readFresh();
    const got = r.get('91:03');
    const ok = got === target;
    console.log(`  читается: ${got}   ${ok ? 'ПРИНЯТО' : 'не принято'}`);
    reps.push({ target, got, ok });
    await sleep(800);
  }

  // ─── все поля полосы с гейтом ───
  console.log('\n' + '-'.repeat(70));
  console.log('ВСЕ ПОЛЯ ПОЛОСЫ В ОДНОМ БРЕКЕТЕ С ГЕЙТОМ');
  console.log('-'.repeat(70));
  await writeBulk([
    [0x9b, 0x0f, 1],
    [0x91, 0x01, 1],
    [0x91, 0x02, 2],
    [0x91, 0x03, 5],
    [0x91, 0x04, 1000],
    [0x91, 0x05, 10000],
  ]);
  const rf = await readFresh();
  const want = [
    ['0x91:01 enable', rf.get('91:01'), 1],
    ['0x91:02 type', rf.get('91:02'), 2],
    ['0x91:03 gain', rf.get('91:03'), 5],
    ['0x91:04 freq', rf.get('91:04'), 1000],
    ['0x91:05 q', rf.get('91:05'), 10000],
  ];
  let allOk = true;
  for (const [name, got, w] of want) {
    const ok = got === w;
    if (!ok) allOk = false;
    console.log(`  ${name.padEnd(16)} -> ${String(got).padStart(6)} (хотели ${String(w).padStart(6)})  ${ok ? 'OK' : '-'}`);
  }

  // ─── откат ───
  console.log('\nОТКАТ…');
  await writeBulk([
    [0x9b, 0x0f, 1],
    [0x91, 0x01, orig.en1 ?? 0],
    [0x91, 0x02, orig.ty1 ?? 1],
    [0x91, 0x03, orig.g1 ?? 0],
    [0x91, 0x04, orig.f1 ?? 632],
    [0x91, 0x05, orig.q1 ?? 7000],
  ]);
  await writeBulk([
    [0x9b, 0x0f, orig.sw ?? 0],
  ]);
  const fin = await readFresh(7000);
  console.log(`  0x91:03 = ${fin.get('91:03')} (было ${orig.g1})`);

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  const okReps = reps.filter((r) => r.ok).length;
  console.log(`  повтор D: ${okReps} из ${reps.length} успешных`);
  console.log(`  все поля полосы: ${allOk ? 'РАБОТАЮТ' : 'не все'}`);
  console.log('');
  if (okReps === reps.length) {
    console.log('  ПОДТВЕРЖДЕНО ВОСПРОИЗВОДИМО.');
    console.log('  РАБОЧИЙ ПРОТОКОЛ: в брекете 0x11:20=1 сначала 0x9b:<in>=1,');
    console.log('  затем параметры полос 0x91..0x94, затем 0x11:20=0.');
  } else if (okReps > 0) {
    console.log('  НЕСТАБИЛЬНО: часть попыток прошла, часть нет.');
    console.log('  Возможно, читать надо в той же сессии или нужна задержка.');
  } else {
    console.log('  НЕ ВОСПРОИЗВЕЛОСЬ. Прошлый успех D — вероятно случайность');
    console.log('  чтения (тег приходит не всегда).');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
