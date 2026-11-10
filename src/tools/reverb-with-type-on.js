/**
 * РЕВЕРБ: ЗАПИСЬ ПРИ ВКЛЮЧЁННОМ ТИПЕ.
 *
 * ═══ ЧТО Я ПРОПУСТИЛ ═══
 *
 * В research/NOTES.md §71 записано чёрным по белому:
 *
 *   «dial'ы реверба НЕ РЕАГИРУЮТ, когда реверб в Bypass.
 *    Сначала нужно включить тип (STUDIO/LIVE/HALL), потом крутить.»
 *
 * Мой прошлый тест (reverb-write-direct.js) писал 0x44:08/09/0a/0f
 * при ReverbType = Bypass. Ничего не применилось, и я объявил вывод
 * «реверб не пишется через HID». Это был неверный вывод: условие
 * опыта было неправильным.
 *
 * ═══ КАРТА ИЗ ДИЗАССЕМБЛЕРА MCC ═══
 *
 * research/NOTES.md §11.5, функция FUN_140230b20 в M Control Center.exe:
 *
 *   0x4408 = Effect_Reverb / DryWet
 *   0x4409 = Effect_Reverb / Room
 *   0x440a = Effect_Reverb / Decay
 *   0x440b = Effect_Reverb / ReverbType   (Bypass=1, STUDIO=2, LIVE=3, HALL=4)
 *   0x440c = Effect_Reverb / MuteFX
 *   0x440f = Effect_Reverb / Width        (значение = int(x*100))
 *
 * Раньше 0x44:09 числился как «код NC» — это была ошибка, там Room.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Включить тип (0x44:0b: 1=Bypass -> 3=LIVE).
 * 2. Сразу проверить, принялся ли тип вообще.
 * 3. Если тип включился — писать параметры и смотреть, примутся ли.
 * 4. Вернуть всё назад, включая Bypass.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG должны быть отключены (проверяется). При включённом
 * ревербе звук мог бы измениться, но выходы физически не подключены.
 * Все значения откатываются, включая тип.
 *
 * Запуск: node src/tools/reverb-with-type-on.js
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

const TYPE_NAMES = { 1: 'Bypass', 2: 'STUDIO', 3: 'LIVE', 4: 'HALL' };

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 16000) {
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
      if (f.target === 0x44) out.set(hex2(f.prop), f.value);
      if ((f.target === 0x64 || f.target === 0x62) && f.prop === 0x06) {
        out.set(`${hex2(f.target)}:06`, f.value);
      }
    }
    if (Date.now() - lk >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lk = Date.now(); }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }
  return out;
}

async function writeOne(prop, value) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (t, p, v) => h.write([...withReportId(buildFrame(t, p, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x44, prop, value);
  await sleep(1200);
  try { h.close(); } catch { /* ok */ }
}

const show = (m) => [...m.entries()]
  .filter(([k]) => !k.includes(':'))
  .sort()
  .map(([k, v]) => `${k}=${v}`)
  .join(' ');

async function main() {
  const before = await snap();
  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`ОСТАНОВ: джек подключён (HP=${hp}, OTG=${otg}).`);
    process.exit(2);
  }

  console.log('до:', show(before));
  const typeBefore = before.get('0b');
  console.log(`\nReverbType сейчас = ${typeBefore} (${TYPE_NAMES[typeBefore] ?? '?'})`);
  console.log('По NOTES §71 дилы не реагируют при Bypass — значит и запись могла не идти.');

  if (typeBefore === undefined) {
    console.log('тег типа не пришёл — стоп');
    process.exit(3);
  }

  const origParams = {
    0x08: before.get('08'),
    0x09: before.get('09'),
    0x0a: before.get('0a'),
    0x0f: before.get('0f'),
  };

  console.log('\n' + '='.repeat(60));
  console.log('ШАГ 1: включаю тип LIVE (0x44:0b = 3)');
  console.log('='.repeat(60));
  await writeOne(0x0b, 3);
  await sleep(1500);
  let s = await snap();
  const typeNow = s.get('0b');
  const typeOk = typeNow === 3;
  console.log(`  0x44:0b: ${typeBefore} -> 3 -> ${typeNow} (${TYPE_NAMES[typeNow] ?? '?'})  ${typeOk ? 'ПРИНЯТО' : 'нет'}`);

  if (!typeOk) {
    console.log('\n  Тип не принялся. Значит 0x44 не пишется вообще,');
    console.log('  и дело не в Bypass. Возвращать нечего.');
    process.exit(0);
  }

  console.log('\n' + '='.repeat(60));
  console.log('ШАГ 2: при включённом типе пишу параметры');
  console.log('='.repeat(60));

  const tests = [
    { pp: 0x08, name: 'DryWet', cur: s.get('08'), to: (v) => (v === 40 ? 25 : 40) },
    { pp: 0x09, name: 'Room', cur: s.get('09'), to: (v) => (v === 6 ? 3 : 6) },
    { pp: 0x0a, name: 'Decay', cur: s.get('0a'), to: (v) => (v === 14 ? 8 : 14) },
    { pp: 0x0f, name: 'Width', cur: s.get('0f'), to: (v) => (v === 80 ? 50 : 80) },
  ];

  const results = [];
  for (const t of tests) {
    if (t.cur === undefined) {
      console.log(`  ${t.name.padEnd(8)} тег не пришёл — пропуск`);
      continue;
    }
    const target = t.to(t.cur);
    await writeOne(t.pp, target);
    await sleep(1200);
    const after = await snap();
    const got = after.get(hex2(t.pp));
    const ok = got === target;
    console.log(`  ${t.name.padEnd(8)} 0x44:${hex2(t.pp)}: ${t.cur} -> ${target} -> ${got}  ${ok ? 'ПРИНЯТО' : 'нет'}`);
    results.push({ ...t, ok, got, target });
  }

  console.log('\n' + '='.repeat(60));
  console.log('ШАГ 3: возвращаю всё');
  console.log('='.repeat(60));

  for (const [pp, val] of Object.entries(origParams)) {
    if (val === undefined) continue;
    await writeOne(Number(pp), val);
    await sleep(800);
  }
  await sleep(600);
  s = await snap();
  console.log(`  параметры: ${show(s)}`);

  // тип возвращаем последним — при Bypass дилы неактивны
  await writeOne(0x0b, typeBefore);
  await sleep(1200);
  const fin = await snap();
  console.log(`  0x44:0b: -> ${fin.get('0b')} (${TYPE_NAMES[fin.get('0b')] ?? '?'})`);

  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  console.log(`ИТОГ: ${passed} из ${results.length} параметров приняты`);
  if (passed > 0) {
    console.log('Реверб ПИШЕТСЯ через HID, когда тип не Bypass.');
    console.log('Прошлый вывод был неверен: условие опыта (Bypass) его сломало.');
  } else {
    console.log('Даже при включённом типе параметры не принялись.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
