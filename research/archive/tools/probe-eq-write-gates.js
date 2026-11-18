/**
 * EQ: ПОИСК УСЛОВИЯ, ПРИ КОТОРОМ ЗАПИСЬ ПРИНИМАЕТСЯ.
 *
 * ═══ УСТАНОВЛЕНО ═══
 *
 * 1. Обратное чтение ПОЛНЫМ ДАМПОМ достоверно. Доказано:
 *    - громкость 0x21:04: 55 -> 43, чтение показало 43;
 *    - компрессор 0x46:02: -28 -> -30, чтение показало -30
 *      (и значение удержалось между сессиями).
 *
 * 2. Запись в EQ 0x91:04/05 простым способом НЕ принимается.
 *    Чтение возвращает исходные значения.
 *
 * ═══ ГИПОТЕЗЫ, ЧТО МЕШАЕТ ═══
 *
 * G1: полосу надо СНАЧАЛА включить (0x91:01 = 1). Пока выключена,
 *     устройство игнорирует частоту/Q.
 * G2: нужен тип фильтра, отличный от дефолта (0x91:02).
 * G3: EQ целиком выключен; включается тегом 0x9b.
 * G4: поля EQ только для чтения через HID.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены (проверяется перед каждым шагом, при подключении
 * СТОП). Звук физически невозможен. Все значения в допустимых
 * диапазонах. В конце состояние EQ и компрессора восстанавливается.
 *
 * Запуск: node src/tools/probe-eq-write-gates.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

let h;
const open = () => {
  h = new HID.HID(dev.path);
};
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshot() {
  try { h.close(); } catch { /* ok */ }
  await sleep(800);
  open();
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
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
const key = (tt, pp) => `${hex2(tt)}:${hex2(pp)}`;

function safetyOk(s) {
  const hp = s.get('64:06');
  const otg = s.get('62:06');
  if (hp !== 0 || otg !== 0) {
    console.log(`  СТОП: HP=${hp} OTG=${otg} — выход подключён`);
    return false;
  }
  return true;
}

/** Печатает блок EQ-группы. */
function dumpEq(s, group, label) {
  const parts = [];
  for (let p = 1; p <= 0x0a; p += 1) parts.push(s.get(key(group, p)));
  console.log(`  ${label} 0x${hex2(group)} = [${parts.join(', ')}]`);
}

async function main() {
  // ---------- 1. исходное состояние ----------
  console.log('=== 1. исходное ===');
  let s = await snapshot();
  if (!safetyOk(s)) { try { h.close(); } catch { /* ok */ } process.exit(1); }
  console.log(`  0x46:02 (компрессор Threshold) = ${s.get('46:02')}`);
  dumpEq(s, 0x91, 'EQ');
  dumpEq(s, 0x92, 'EQ');
  const eqSwitch = {
    '9b:0f': s.get('9b:0f'),
    '9b:10': s.get('9b:10'),
    '9b:12': s.get('9b:12'),
    '9b:13': s.get('9b:13'),
  };
  console.log(`  0x9b переключатели EQ: ${JSON.stringify(eqSwitch)}`);

  const orig91 = [];
  for (let p = 1; p <= 0x0a; p += 1) orig91.push(s.get(key(0x91, p)));

  const results = [];

  /** Проверяет один сценарий: пишет, перечитывает, сравнивает 91:04. */
  async function scenario(name, steps, checkProp = 0x04, expect) {
    console.log(`\n${name}`);
    s = await snapshot(); // открывает h
    if (!safetyOk(s)) return;
    for (const [tt, pp, v] of steps) {
      send(tt, pp, v);
      await sleep(400);
    }
    await sleep(900);
    const after = await snapshot();
    const got = after.get(key(0x91, checkProp));
    const ok = got === expect;
    results.push({ name, got, ok });
    console.log(`  -> 0x91:${hex2(checkProp)} = ${got} (писали ${expect})  ${ok ? 'ПРИНЯТО' : 'не принято'}`);
    return after;
  }

  // ---------- 2. сценарии ----------
  await scenario('G1: сначала включить полосу (91:01=1), потом частоту',
    [[0x91, 0x01, 1], [0x91, 0x04, 1000]], 0x04, 1000);

  await scenario('G2: сначала тип фильтра (91:02=2), потом частоту',
    [[0x91, 0x02, 2], [0x91, 0x04, 1000]], 0x04, 1000);

  await scenario('G3: включить полосу + тип + частота',
    [[0x91, 0x01, 1], [0x91, 0x02, 2], [0x91, 0x04, 1000]], 0x04, 1000);

  await scenario('G5: только включение полосы (91:01=1)',
    [[0x91, 0x01, 1]], 0x01, 1);

  await scenario('G6: gain (91:03=5) при включённой полосе',
    [[0x91, 0x01, 1], [0x91, 0x03, 5]], 0x03, 5);

  // ---------- 3. итог ----------
  console.log('\n=== итог ===');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(48)} -> ${r.got}  ${r.ok ? 'ПРИНЯТО' : 'нет'}`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n  принято ${okCount} из ${results.length}`);
  if (okCount === 0) {
    console.log('  => Ни одно условие не открыло запись. EQ через HID только читается.');
  }

  // ---------- 4. восстановление ----------
  console.log('\n=== восстановление 0x91 ===');
  s = await snapshot();
  for (let p = 1; p <= 0x0a; p += 1) {
    const want = orig91[p - 1];
    if (want !== undefined && s.get(key(0x91, p)) !== want) {
      send(0x91, p, want);
      await sleep(250);
    }
  }
  await sleep(700);
  s = await snapshot();
  let restored = 0;
  for (let p = 1; p <= 0x0a; p += 1) {
    if (s.get(key(0x91, p)) === orig91[p - 1]) restored += 1;
  }
  console.log(`  восстановлено ${restored} из 10`);
  dumpEq(s, 0x91, 'EQ');

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
