/**
 * 0x21:0x02 — ЭТО 48V? ПРОВЕРКА ГИПОТЕЗЫ.
 *
 * ═══ ОТКУДА ГИПОТЕЗА ═══
 *
 * Из захвата `source-codes.pcap` видно, что MCC отправляет свойства
 * входов, которых не было в нашей карте:
 *
 *     0x21:0x02 = 1     0x21:0x03 = 0     0x21:0x05 = 0
 *     0x22:0x03 = 0     0x22:0x05 = 1
 *     0x23:0x05 = 0     0x25:0x05 = 0     0x27:0x05 = 0
 *
 * Заметьте асимметрию: 0x21:0x02 = 1, но у 0x22 свойства 0x02 нет
 * вообще. И 0x21:0x05 = 0 при 0x22:0x05 = 1.
 *
 * У входа IN1 (0x21) известны: 0x01 метр, 0x04 громкость, 0x06 джек.
 * Значит 0x02, 0x03, 0x05 — что-то ещё. 48V — первая гипотеза.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Читаем состояние 0x11:0x19 (48V IN1) и 0x11:0x1a (кандидат IN2).
 * 2. Пишем 1 в 0x21:0x02 и смотрим, изменилось ли 0x11:0x19.
 * 3. Пишем 0 — смотрим.
 * 4. То же для 0x21:0x05 и 0x22:0x05.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG проверяются. 48V — фантом микрофона, к входу
 * ничего не подключено (джек IN1 = 0 проверяется).
 * Все значения откатываются.
 *
 * Запуск: node src/tools/prove-21-02-is-48v.js
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
    while (Date.now() - t0 < 15000) {
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

const NOISE = new Set([
  '11:18', '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02', '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01', '9b:0b',
]);

function diff(a, b) {
  const out = [];
  for (const [k, v] of a) {
    if (NOISE.has(k)) continue;
    if (!b.has(k)) continue;
    if (b.get(k) !== v) out.push({ key: k, from: v, to: b.get(k) });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

async function main() {
  const base = await fullSnap();
  console.log(`базовый снимок: ${base.size} тегов`);

  const hp = base.get('64:06');
  const otg = base.get('62:06');
  const in1 = base.get('21:06');
  const in2 = base.get('22:06');
  console.log(`наушники=${hp}  OTG=${otg}  джек IN1=${in1}  джек IN2=${in2}`);

  if (hp === 1 || otg === 1) {
    console.log('ОСТАНОВ: джек HP/OTG подключён');
    process.exit(2);
  }
  if (in1 === 1) {
    console.log('ВНИМАНИЕ: к входу IN1 что-то подключено.');
    console.log('48V подаст на него питание. Если это микрофон — норм,');
    console.log('если линия/инструмент — не трогаем.');
    if (process.env.M62_ALLOW_48V !== '1') {
      console.log('\nДля продолжения: M62_ALLOW_48V=1 node ...');
      process.exit(2);
    }
  }

  console.log(`\nсостояние 48V до опыта:`);
  console.log(`  0x11:19 (IN1) = ${base.get('11:19')}`);
  console.log(`  0x11:1a (IN2) = ${base.get('11:1a')}`);

  /**
   * Кандидаты. Пишем по одному, смотрим не только целевой тег,
   * но и всё, что изменилось.
   */
  const candidates = [
    { tt: 0x21, pp: 0x02, name: 'IN1 prop2', values: [1, 0] },
    { tt: 0x21, pp: 0x05, name: 'IN1 prop5', values: [1, 0] },
    { tt: 0x22, pp: 0x05, name: 'IN2 prop5', values: [1, 0] },
    { tt: 0x22, pp: 0x02, name: 'IN2 prop2', values: [1, 0] },
  ];

  const hits = [];

  for (const c of candidates) {
    const tag = `${hex2(c.tt)}:${hex2(c.pp)}`;
    console.log(`\n${'='.repeat(58)}`);
    console.log(`${c.name} (0x${tag})`);
    console.log('='.repeat(58));

    for (const v of c.values) {
      console.log(`\n  пишу 0x${tag} = ${v}…`);
      await cmd(c.tt, c.pp, v);
      await sleep(1200);

      const after = await fullSnap();
      const changed = diff(base, after);

      if (!changed.length) {
        console.log('    других изменений нет');
      } else {
        console.log(`    изменилось ${changed.length} тег(ов):`);
        for (const x of changed) {
          console.log(`      0x${x.key}  ${x.from} -> ${x.to}`);
          // интересует именно 48V
          if (x.key === '11:19' || x.key === '11:1a') {
            hits.push({ cand: c.name, tag, v, state: x.key, from: x.from, to: x.to });
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(58));
  console.log('ИТОГ');
  console.log('='.repeat(58));

  if (hits.length) {
    console.log('  НАЙДЕНО! Управление 48V:');
    for (const h of hits) {
      console.log(`    0x${h.tag} = ${h.v}  ->  ${h.state}: ${h.from} -> ${h.to}`);
    }
    console.log('\n  Это и есть команда фантома.');
  } else {
    console.log('  Ни один кандидат не изменил состояние 48V (0x11:19/1a).');
    console.log('  Значит 0x21:xx / 0x22:xx — что-то другое.');
    console.log('\n  Следующий шаг: захват с нажатием кнопки 48V —');
    console.log('  там будет видно точный кадр.');
    console.log('  Скрипт готов: .\\capture-48v-and-mask.ps1 (от админа)');
  }

  // вернуть всё
  const fin = await fullSnap();
  console.log(`\nсостояние после: 0x11:19=${fin.get('11:19')} 0x11:1a=${fin.get('11:1a')}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
