/**
 * ЧТО ВООБЩЕ ПИШЕТСЯ В УСТРОЙСТВО СЕЙЧАС?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * NOTES §135.2 (2026-11-10) фиксировал 12/12 принятых записей.
 * Сегодня (2026-11-13) НИ ОДНА запись не принимается, включая
 * 0x91:03, который работал.
 *
 * Прежде чем чинить EQ, надо понять: сломано всё или только EQ.
 * Поэтому пишем по одному тегу из РАЗНЫХ семейств и читаем
 * в НОВОЙ сессии:
 *
 *   0x46:03  компрессор Ratio    (документировано как рабочее)
 *   0x44:08  реверб dryWet       (документировано как рабочее)
 *   0x91:03  EQ gain             (сегодня НЕ работает)
 *   0x62:03  громкость OTG       (простая запись)
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 *   H1. Устройство в состоянии, когда записи игнорируются
 *       (например, после смены режима не завершилась инициализация).
 *   H2. Сломано всё — нужен другой метод (save/брекет).
 *   H3. Сломано только EQ.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Reverb ставим только если
 * тип не Bypass (иначе параметры игнорируются — известное правило).
 * Все значения откатываются.
 *
 * Запуск: node src/tools/prove-write-health.js
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
  return HID.devices()
    .filter((d) => d.vendorId === VID && d.productId === PID)
    .find((d) => d.interface === 4);
}

async function session(ms = 9000, action = null) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(450);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(500);

  if (action) await action(send);

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

async function main() {
  console.log('='.repeat(70));
  console.log('ЧТО ПИШЕТСЯ В УСТРОЙСТВО — ПРОВЕРКА ПО СЕМЕЙСТВАМ');
  console.log('='.repeat(70));

  const base = await session();
  const jack = base.get('64:06');
  const mute0 = base.get('64:04');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  let restoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    await session(4000, async (send) => {
      send(0x64, 0x04, 1);
      await sleep(900);
    });
    const chk = await session(4000);
    if (chk.get('64:04') !== 1) {
      console.log('не заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    restoreMute = true;
    console.log('  заглушено и подтверждено');
  } else {
    console.log('  безопасно');
  }

  const s0 = await session();
  const orig = {
    comp: s0.get('46:03'),
    rvType: s0.get('44:0b'),
    rvWet: s0.get('44:08'),
    eq: s0.get('91:03'),
    otg: s0.get('62:03'),
  };
  console.log('\nисходные значения:');
  console.log(`  0x46:03 comp ratio   = ${orig.comp}`);
  console.log(`  0x44:0b reverb type  = ${orig.rvType}`);
  console.log(`  0x44:08 reverb dryWet= ${orig.rvWet}`);
  console.log(`  0x91:03 eq gain      = ${orig.eq}`);
  console.log(`  0x62:03 otg volume   = ${orig.otg}`);

  const results = [];

  // ─── универсальная проба: запись в сессии, чтение в новой ───
  const probe = async (label, tt, pp, from, to) => {
    if (from === undefined || from === null) {
      console.log(`\n${label}: 0x${hex2(tt)}:0x${hex2(pp)} — исходное НЕ ПРИШЛО, пропуск`);
      results.push({ label, ok: null, note: 'тег не приходит' });
      return;
    }
    if (from === to) {
      console.log(`\n${label}: 0x${hex2(tt)}:0x${hex2(pp)} — уже ${to}, пропуск`);
      results.push({ label, ok: null, note: 'уже целевое' });
      return;
    }
    console.log(`\n${label}: 0x${hex2(tt)}:0x${hex2(pp)}  ${from} -> пишу ${to}`);
    await session(3000, async (send) => {
      send(tt, pp, to);
      await sleep(900);
    });
    await sleep(800);
    const after = await session();
    const got = after.get(`${hex2(tt)}:${hex2(pp)}`);
    const ok = got === to;
    console.log(`  читается: ${got}   ${ok ? 'ПРИНЯТО' : 'НЕ принято'}`);
    results.push({ label, ok, got, to, from, addr: `0x${hex2(tt)}:0x${hex2(pp)}` });
    // откат
    if (ok) {
      await session(2500, async (send) => {
        send(tt, pp, from);
        await sleep(700);
      });
      await sleep(600);
    }
  };

  // компрессор: ratio 40 -> 60 (документировано как рабочее)
  await probe('Компрессор ratio', 0x46, 0x03, orig.comp, orig.comp === 60 ? 40 : 60);

  // EQ gain (сегодня не работает)
  await probe('EQ band1 gain', 0x91, 0x03, orig.eq, orig.eq === 3 ? 0 : 3);

  // громкость OTG
  if (orig.otg !== undefined && orig.otg !== null) {
    // громкость в Q25, возьмём половину
    const target = orig.otg > 0 ? Math.round(orig.otg / 2) : 16777216;
    await probe('OTG volume', 0x62, 0x03, orig.otg, target);
  }

  if (restoreMute) {
    await session(2500, async (send) => {
      send(0x64, 0x04, mute0 ?? 0);
      await sleep(700);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));
  for (const r of results) {
    if (r.ok === null) {
      console.log(`  ${r.label.padEnd(22)} ${r.note}`);
    } else {
      console.log(
        `  ${r.label.padEnd(22)} ${r.addr}  ${String(r.from).padStart(9)} -> ${String(r.to).padStart(9)}  `
        + `${String(r.got).padStart(9)}  ${r.ok ? 'ПИШЕТСЯ' : 'НЕ пишется'}`,
      );
    }
  }

  const known = results.filter((r) => r.ok !== null);
  const okCount = known.filter((r) => r.ok).length;
  console.log('');
  console.log(`  пишется: ${okCount} из ${known.length}`);
  if (okCount === 0) {
    console.log('  => не пишется НИЧЕГО. Проблема не в EQ, а в устройстве/методе.');
  } else if (okCount < known.length) {
    console.log('  => пишется частично. Смотрим, что именно не пишется.');
  } else {
    console.log('  => пишется всё. Значит прошлые тесты EQ были с ошибкой.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
