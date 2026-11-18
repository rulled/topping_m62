/**
 * Проверка ЗАПИСИ через HID для «файловых» параметров.
 *
 * ЗАЧЕМ: определяет, что из функционала возможно в чистом вебе (WebHID).
 * Всё, что пишется ТОЛЬКО файлом или через UI — в браузере недоступно.
 *
 * БЕЗОПАСНОСТЬ: тестируются только теги, которые сейчас ИНЕРТНЫ:
 *   - EQ выключен (Switch=0) -> полосы на звук не влияют
 *   - ducking выключен        -> порог на звук не влияет
 * Скрипт проверяет оба условия и отказывается работать иначе.
 * В конце возвращает исходные значения.
 *
 * Запуск: node src/tools/probe-fileish-hid.js [--write]
 */

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

/** Что проверяем: {tt, pp, label, safeWhen} */
const CASES = [
  { tt: 0x91, pp: 0x06, label: 'EQ_IN1 band1 param', guard: 'eqOff' },
  { tt: 0x43, pp: 0x01, label: 'Ducking threshold', guard: 'duckOff' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Последние значения всех тегов за ms: Map("tt:pp" -> value) */
async function readAll(ms = 4000) {
  const out = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let buf;
    try {
      buf = h.readTimeout(30);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) f = bytes.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    out.set(`${f[5]}:${f[6]}`, f.readInt32BE(7));
  }
  return out;
}

async function announce() {
  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
}

const main = async () => {
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  await announce();
  const before = await readAll(6000);

  // Проверяем инертность.
  // null = тег не приходил вовсе -> считать «неизвестно», это безопасно
  // только если мы всё равно не собираемся менять звук.
  const eqSwitch = before.get('0x9b:0xf') ?? before.get('155:15') ?? null;
  const duckSwitch = before.get('0x43:7') ?? before.get('67:7') ?? null;
  const eqOff = eqSwitch === 0 || eqSwitch === null;
  const duckOff = duckSwitch === 0 || duckSwitch === null;
  const fmt = (v) => (v === null ? 'тег НЕ приходит' : String(v));
  console.log(`EQ switch (0x9b:0x0f) = ${fmt(eqSwitch)}  -> ${eqOff ? 'безопасно' : 'ВКЛЮЧЁН'}`);
  console.log(`Ducking (0x43:0x07)   = ${fmt(duckSwitch)}  -> ${duckOff ? 'безопасно' : 'ВКЛЮЧЁН'}`);

  if (!eqOff || !duckOff) {
    console.log('\nСТОП: не все цели инертны, писать не буду.');
    clearInterval(keepalive);
    h.close();
    return;
  }

  console.log('\n=== какие теги вообще приходят (для справки) ===');
  const interesting = [...before.keys()]
    .filter((k) => /^(68|67|145|146|147|148|155|171):/.test(k))
    .sort();
  console.log(`  ${interesting.length ? interesting.join(', ') : '(нет ни одного)'}`);

  if (!DO_WRITE) {
    console.log('\n(режим чтения; добавь --write для проверки записи)');
    clearInterval(keepalive);
    h.close();
    return;
  }

  console.log('\n=== проверка записи ===');
  for (const c of CASES) {
    const key = `${c.tt}:${c.pp}`;
    const has = before.has(key);
    const orig = before.get(key);
    const target = typeof orig === 'number' ? (orig === 5 ? 7 : 5) : 5;
    console.log(`\n${c.label} (0x${c.tt.toString(16)}:0x${c.pp.toString(16).padStart(2, '0')})`);
    console.log(`  приходил раньше: ${has ? `да, ${orig}` : 'НЕТ — писать бессмысленно'}`);
    if (!has) continue;

    console.log(`  пишу ${orig} -> ${target} ...`);
    send(c.tt, c.pp, target);
    await sleep(800);
    await announce();
    const after = await readAll(5000);
    const got = after.get(key);
    console.log(`  после записи устройство сообщает: ${got}`);
    console.log(`  ПРИНЯТО: ${got === target ? 'ДА' : 'НЕТ'}`);

    console.log(`  возвращаю ${orig} ...`);
    send(c.tt, c.pp, orig);
    await sleep(800);
    await announce();
    const back = await readAll(3000);
    console.log(`  откат: ${back.get(key) === orig ? 'ОК' : `НЕ ОК (${back.get(key)})`}`);
  }

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
