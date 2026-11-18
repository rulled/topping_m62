/**
 * НЕИЗВЕСТНЫЕ АДРЕСА, КОТОРЫЕ MCC ОТПРАВЛЯЕТ — ЧТО ЭТО.
 *
 * ═══ ЧТО НАЙДЕНО В ЗАХВАТАХ ═══
 *
 * `what-mcc-sends-all.py` показал: MCC отправляет 25 адресов, которых
 * нет в нашей карте. Среди них особенно интересны:
 *
 *   0x61:0x04  значения [0, 1]   — переключатель на OTG OUT
 *   0x63:0x04  значения [0, 1]   — переключатель на HP
 *   0x21:0x0a  значение  [0]     — свойство входа IN1
 *   0x22:0x0a  значение  [0]     — свойство входа IN2
 *   0x23:0x05 / 0x0a             — свойства AUX
 *   0x25:0x05 / 0x0a             — свойства BT
 *   0x27:0x05 / 0x0a             — свойства OTG
 *
 * Гипотезы:
 *   - 0x61/0x63:0x04 — это MUTE выходов (в нашей карте было
 *     предположение, но не проверено). 0x64:0x04 уже известен
 *     как mute HP, а 0x63:0x04 — парный к нему.
 *   - 0x2x:0x0a — возможно, 48V или другой флаг входа.
 *
 * ═══ МЕТОД ═══
 *
 * Пишем 1 в каждый кандидат и смотрим, что меняется в состоянии.
 * Всё откатываем.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG должны быть ОТКЛЮЧЕНЫ — проверяется. Mute-флаги
 * безопасны в любом случае (они только глушат).
 *
 * Запуск: node src/tools/prove-unknown-addresses.js
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

async function fullSnap(min = 100, attempts = 3) {
  let best = new Map();
  for (let i = 1; i <= attempts; i++) {
    const dev = findDev();
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

async function writeOne(tt, pp, value) {
  const dev = findDev();
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

const NOISE = new Set(['11:18']);

/** Только реальные изменения значения в тегах, бывших в обоих снимках. */
function diff(a, b) {
  const out = [];
  for (const [k, v] of a) {
    if (NOISE.has(k)) continue;
    if (!b.has(k)) continue;
    if (b.get(k) !== v) out.push({ key: k, from: v, to: b.get(k) });
  }
  return out;
}

async function main() {
  const base = await fullSnap();
  console.log(`базовый снимок: ${base.size} тегов`);

  const hp = base.get('64:06');
  const otg = base.get('62:06');
  console.log(`наушники=${hp}  OTG=${otg}`);
  if (hp === 1 || otg === 1) {
    console.log('джеки подключены — mute-тесты всё равно безопасны,');
    console.log('но для чистоты лучше отключить.\n');
  }

  /**
   * Кандидаты. Каждый пишем значением, противоположным текущему,
   * чтобы увидеть эффект, затем откатываем.
   */
  const candidates = [
    { tt: 0x61, pp: 0x04, name: 'OTG L mute?', values: [1] },
    { tt: 0x63, pp: 0x04, name: 'HP L mute?', values: [1] },
    { tt: 0x21, pp: 0x0a, name: 'IN1 prop0a', values: [1] },
    { tt: 0x22, pp: 0x0a, name: 'IN2 prop0a', values: [1] },
    { tt: 0x23, pp: 0x05, name: 'AUX prop05', values: [1] },
    { tt: 0x23, pp: 0x0a, name: 'AUX prop0a', values: [1] },
    { tt: 0x25, pp: 0x05, name: 'BT prop05', values: [1] },
    { tt: 0x25, pp: 0x0a, name: 'BT prop0a', values: [1] },
    { tt: 0x27, pp: 0x05, name: 'OTG prop05', values: [1] },
    { tt: 0x27, pp: 0x0a, name: 'OTG prop0a', values: [1] },
  ];

  for (const c of candidates) {
    const tag = `${hex2(c.tt)}:${hex2(c.pp)}`;
    const before = base.get(tag);
    const target = c.values[0];

    console.log(`\nпишу 0x${tag} = ${target} (было ${before ?? 'тега нет'})  [${c.name}]`);
    await writeOne(c.tt, c.pp, target);
    await sleep(1000);

    const after = await fullSnap();
    const got = after.get(tag);
    const changes = diff(base, after);

    console.log(`  стало: 0x${tag} = ${got}`);
    if (changes.length) {
      console.log(`  изменилось ${changes.length} тег(ов):`);
      for (const x of changes) console.log(`    0x${x.key}  ${x.from} -> ${x.to}`);
    } else {
      console.log('  других изменений нет');
    }

    // откат
    if (before !== undefined) {
      await writeOne(c.tt, c.pp, before);
      await sleep(800);
      console.log(`  откат в ${before}`);
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log('ИТОГ');
  console.log('='.repeat(64));
  console.log('  Смотри выше: какой кандидат вызвал изменение состояния.');
  console.log('  Особенно ищи в разнице 0x11:19 (48V) — если он менялся,');
  console.log('  значит найдено управление фантомом.');
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
