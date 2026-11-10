/**
 * 48V: ГИПОТЕЗА — 0x11:0x19 ЭТО СОСТОЯНИЕ, А УПРАВЛЕНИЕ В 0x21/0x22.
 *
 * ═══ ЧТО УЖЕ ИЗВЕСТНО ═══
 *
 *   - `0x11:0x19` меняется 0 -> 1 при нажатии кнопки 48V в MCC.
 *     Значит это ТЕГ СОСТОЯНИЯ фантома для IN1.
 *   - Прямая запись в `0x11:0x19` не применяется (ни кадром, ни в брекете).
 *     Логично: состояние устройство сообщает, но не принимает.
 *   - В INI ключ `48V` есть, но MCC его при старте не применяет —
 *     проверено, устройство осталось на 1 при файле 0.
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * В патче mainline-драйвера сказано: «the input power ... remain
 * reachable only through the hidraw node». То есть питание входов
 * В ПРОТОКОЛЕ ЕСТЬ, просто не описано драйвером.
 *
 * У входа IN1 (семейство 0x21) нам известны только:
 *   0x21:0x01 метр, 0x21:0x04 громкость, 0x21:0x06 джек
 *
 * Пропущены 0x02, 0x03, 0x05. Одно из них может быть управлением
 * питанием. Аналогично 0x22 у IN2.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Пишем 0 и 1 в 0x21:0x02, 0x21:0x03, 0x21:0x05 (и то же для 0x22)
 * и смотрим, меняется ли при этом 0x11:0x19.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * 48V сейчас ВКЛЮЧЁН (0x11:19 = 1). Цель — выключить.
 * Фантом на наушники не влияет. Если попадём в другой параметр —
 * увидим это по изменению не того тега и вернём назад.
 *
 * Запуск: node src/tools/hunt-48v-control.js
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
const STATE_TAG = '11:19'; // состояние 48V для IN1

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 12000) {
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
  return out;
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

const NOISE = new Set([
  '11:18', '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02', '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01', '9b:0b',
]);

function diffAll(a, b) {
  const out = [];
  for (const [k, v] of b) {
    if (NOISE.has(k)) continue;
    const was = a.get(k);
    if (was !== undefined && was !== v) out.push({ key: k, from: was, to: v });
  }
  return out;
}

async function main() {
  const base = await snap();
  const start = base.get(STATE_TAG);
  console.log(`0x${STATE_TAG} (48V IN1) сейчас = ${start}`);
  console.log(`пробую выключить: цель 0\n`);

  /**
   * Кандидаты на управление. Проверяем и 0x21 (IN1), и 0x22 (IN2),
   * потому что не знаем, к какому входу относится тег состояния.
   */
  const candidates = [
    { tt: 0x21, pp: 0x02, name: 'IN1 prop2' },
    { tt: 0x21, pp: 0x03, name: 'IN1 prop3' },
    { tt: 0x21, pp: 0x05, name: 'IN1 prop5' },
    { tt: 0x22, pp: 0x02, name: 'IN2 prop2' },
    { tt: 0x22, pp: 0x03, name: 'IN2 prop3' },
    { tt: 0x22, pp: 0x05, name: 'IN2 prop5' },
  ];

  const results = [];

  for (const c of candidates) {
    console.log(`пробую 0x${c.tt.toString(16)}:0x${c.pp.toString(16)} (${c.name}) = 0 …`);
    await writeOne(c.tt, c.pp, 0);
    await sleep(1200);

    const after = await snap();
    const state = after.get(STATE_TAG);
    const changes = diffAll(base, after);
    const off = state === 0;

    console.log(`   0x${STATE_TAG} = ${state}${off ? '  <<< ВЫКЛЮЧИЛСЯ!' : ''}`);
    if (changes.length) {
      for (const x of changes) console.log(`   изменился 0x${x.key}: ${x.from} -> ${x.to}`);
    }

    results.push({ ...c, state, off });

    if (off) {
      console.log(`\nНАЙДЕНО: управление 48V — это 0x${c.tt.toString(16)}:0x${c.pp.toString(16)}`);
      break;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ');
  console.log('='.repeat(60));
  const hit = results.find((r) => r.off);
  if (hit) {
    console.log(`  Управление 48V: 0x${hit.tt.toString(16)}:0x${hit.pp.toString(16)}`);
    console.log(`  Состояние:      0x${STATE_TAG}`);
    console.log('\n  Проверить обратное включение и записать в NOTES.');
  } else {
    console.log('  Ни один кандидат не выключил 48V.');
    console.log('  Значит управление либо в другом семействе,');
    console.log('  либо 48V меняется только командой через MCC');
    console.log('  (не прямой записью).');
    console.log('\n  Состояние 48V осталось =', results[results.length - 1].state);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
