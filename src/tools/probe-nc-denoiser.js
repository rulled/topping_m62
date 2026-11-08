/**
 * ПОИСК БЛОКОВ NC / DENOISE / EXPANDER (0xa1..0xaa и рядом).
 *
 * ═══ ЧТО НАЙДЕНО В MCC ═══
 *
 * Реверс строк показал ЧЕТЫРЕ DSP-блока, которых нет в workspace-INI:
 *
 *     Compressor_IN1 / Compressor_IN2   (а мы видели только один Compressor)
 *     Expander_IN1 / Expander_IN2       (не видели вообще)
 *     Denoise_IN1 / Denoise_IN2         (не видели вообще)
 *     Ducking
 *
 * В UI это вкладки: EQ, NC, COMP, EXP.
 *
 * В workspace-INI есть:
 *     Mobile:  Effect_NC, Effect_Reverb
 *     Live:    Effect_Integration (NC + Reverb в одной секции)
 *     Prof:    EQ_HP на 6 полос
 *
 * Значит NC (шумоподавление) активно в Mobile и Live, но его ТЕГОВ в
 * потоке мы НЕ ВИДЕЛИ. Гипотеза: они в блоке 0xa1..0xaa, который
 * приходит только при определённых условиях.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Слушает полный дамп и ищет ВСЁ, что начинается с a, b, c — а также
 * любые семейства, которых не было в известном списке.
 *
 * Запуск: node src/tools/probe-nc-denoiser.js
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
const SNAPSHOT_MS = 9000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Что уже известно из Live-режима. */
const KNOWN = new Set([
  '11', '12', '21', '22', '23', '25', '27',
  '31', '32', '33', '34', '35', '36', '37', '38', '39', '3b', '3c',
  '43', '44', '45', '46',
  '51', '52', '53', '54', '55', '56', '57', '58',
  '61', '62', '63', '64',
  '91', '92', '93', '94', '9b',
]);

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const state = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
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
      state.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  console.log(`адресов: ${state.size}\n`);

  // ─── всё, что начинается с a/b/c ───
  console.log('=== блоки 0xa*, 0xb*, 0xc* ===');
  const abc = [...state.keys()].filter((k) => /^[abc]/.test(k)).sort();
  if (!abc.length) {
    console.log('  НЕТ НИ ОДНОГО');
  } else {
    for (const k of abc) console.log(`  ${k} = ${state.get(k)}`);
  }

  // ─── незнакомые семейства ───
  console.log('\n=== незнакомые семейства ===');
  const families = new Set([...state.keys()].map((k) => k.slice(0, 2)));
  const unknown = [...families].filter((f) => !KNOWN.has(f)).sort();
  if (!unknown.length) {
    console.log('  все семейства известны');
  } else {
    for (const f of unknown) {
      const tags = [...state.keys()].filter((k) => k.startsWith(`${f}:`)).sort();
      console.log(`  0x${f}: ${tags.length} тегов -> ${tags.join(' ')}`);
    }
  }

  // ─── полный список семейств ───
  console.log('\n=== все семейства ===');
  for (const f of [...families].sort()) {
    const n = [...state.keys()].filter((k) => k.startsWith(`${f}:`)).length;
    console.log(`  0x${f}: ${n}`);
  }

  // ─── 0x44 подробно (там NC во всех режимах) ───
  console.log('\n=== 0x44 подробно (NC / Reverb) ===');
  const fx = [...state.entries()].filter(([k]) => k.startsWith('44:')).sort();
  if (!fx.length) {
    console.log('  нет');
  } else {
    for (const [k, v] of fx) console.log(`  ${k} = ${v}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
