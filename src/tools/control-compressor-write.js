/**
 * КОНТРОЛЬНЫЙ ОПЫТ: метод проверки записи вообще рабочий?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * decode-eq-fields.js показал: запись в 0x91 не принимается (0 из 5).
 * Но это может значить ДВЕ разные вещи:
 *
 *   A) EQ действительно не пишется через HID — и это факт о протоколе.
 *   B) Мой метод снимка не видит изменения — и это ошибка метода.
 *
 * Чтобы различить, нужен контрольный опыт на теге, который ТОЧНО пишется.
 * Компрессор (0x46:02..08) — известен рабочий: раньше проверено, что
 * Threshold -28 -> -30, Attack 5 -> 6 доезжают до INI.
 *
 * Если компрессор проходит, а EQ нет — вывод A верен.
 * Если компрессор тоже нет — метод сломан, и вывод про EQ недействителен.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены. Значения компрессора в допустимых диапазонах:
 * Threshold -36..0, Ratio 0..1000000, Attack 1..500, Release 1..601.
 * В конце восстанавливаются исходные.
 *
 * Запуск: node src/tools/control-compressor-write.js
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
const SNAPSHOT_MS = 7000;
const KEEPALIVE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;

async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(700); // между сессиями обязательна пауза, иначе полного дампа нет
  h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
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
      out.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    if (Date.now() - lastKeep >= KEEPALIVE_MS) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

/** Пишет значение на уже открытом соединении. */
async function writeLive(tt, pp, v) {
  const send = (t, p, val) => h.write([...withReportId(buildFrame(t, p, val, true))]);
  send(tt, pp, v);
  await sleep(350);
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  // 0x46:02 Threshold, 0x46:04 Attack. Оба точно пишутся (проверено раньше).
  const TARGETS = [
    { prop: 0x02, test: -30, name: 'Threshold' },
    { prop: 0x04, test: 6, name: 'Attack' },
  ];

  console.log('снимок 1 …');
  const before = await snapshot();
  console.log(`  адресов ${before.size}`);
  for (const t of TARGETS) {
    const k = `46:${hex2(t.prop)}`;
    console.log(`  ${k} (${t.name}) = ${before.get(k)}`);
  }

  console.log('\nпишем и перечитываем:');
  let accepted = 0;
  for (const t of TARGETS) {
    const key = `46:${hex2(t.prop)}`;
    const orig = before.get(key);

    await writeLive(0x46, t.prop, t.test);
    const after = await snapshot();
    const got = after.get(key);
    const ok = got === t.test;
    if (ok) accepted += 1;
    console.log(
      `  ${key} (${t.name})  было ${orig} -> писали ${t.test} -> стало ${got}   ` +
        `${ok ? '=> ПРИНЯТО' : '=> НЕ ПРИНЯТО'}`,
    );

    // вернуть сразу, чтобы следующий тест шёл с чистого листа
    if (orig !== undefined) {
      await writeLive(0x46, t.prop, orig);
    }
  }

  console.log(`\nитог контрольного опыта: принято ${accepted} из ${TARGETS.length}`);
  if (accepted === TARGETS.length) {
    console.log('МЕТОД РАБОЧИЙ. Значит отказ записи в 0x91 — факт о протоколе,');
    console.log('а не дефект измерения. EQ пишется не через HID.');
  } else {
    console.log('МЕТОД НЕ РАБОЧИЙ. Вывод про EQ недостоверен, надо чинить снимок.');
  }

  // финальная сверка
  const final = await snapshot();
  for (const t of TARGETS) {
    const key = `46:${hex2(t.prop)}`;
    const want = before.get(key);
    const got = final.get(key);
    console.log(`  восстановление ${key}: ${got} ${got === want ? 'ok' : `(ждали ${want})`}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
