/**
 * ПИШЕТСЯ ЛИ РЕВЕРБ ЧЕРЕЗ HID НАПРЯМУЮ.
 *
 * ═══ ГИПОТЕЗА ═══
 *
 * Теги 0x44:08/09/0a/0f совпали по значению с параметрами реверба
 * из INI:
 *
 *   0x44:08 = 30  DryWetBypass = 30
 *   0x44:09 =  4  ReverbBypass = 4
 *   0x44:0a = 11  DecayBypass  = 11
 *   0x44:0f = 70  WidthBypass  = 0.7 (x100)
 *
 * EQ и компрессор пишутся прямой записью в HID — вполне возможно,
 * что и эти четыре пишутся так же. Тогда карта реверба закрывается
 * без всякого UI.
 *
 * ═══ МЕТОД ═══
 *
 * Правила проекта: MCC закрыт, снимок «до» и «после» — РАЗНЫЕ сессии,
 * значение считается принятым только если видно в новой сессии.
 *
 * Меняем по одному, откатываем.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники и OTG должны быть отключены. ReverbType сейчас Bypass —
 * то есть реверб выключен, и даже изменение его параметров на звук
 * не влияет. Тем не менее всё откатывается.
 *
 * Запуск: node src/tools/reverb-write-direct.js
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

async function freshSnapshot(ms = 16000) {
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
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target === 0x44) out.set(hex2(f.prop), f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch { /* ok */ }
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
  try {
    h.close();
  } catch { /* ok */ }
}

async function main() {
  console.log('снимок «до»…');
  const before = await freshSnapshot();

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    // джеки другого семейства, читаем отдельно — здесь для чистоты
  }
  console.log('  0x44:', [...before.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));

  // что меняем: свойство -> (новое значение, имя)
  const plan = [];
  const v08 = before.get('08');
  const v09 = before.get('09');
  const v0a = before.get('0a');
  const v0f = before.get('0f');

  if (v08 !== undefined) plan.push({ pp: 0x08, from: v08, to: v08 === 20 ? 30 : 20, name: 'DryWet?' });
  if (v09 !== undefined) plan.push({ pp: 0x09, from: v09, to: v09 === 3 ? 4 : 3, name: 'Room?' });
  if (v0a !== undefined) plan.push({ pp: 0x0a, from: v0a, to: v0a === 12 ? 11 : 12, name: 'Decay?' });
  if (v0f !== undefined) plan.push({ pp: 0x0f, from: v0f, to: v0f === 60 ? 70 : 60, name: 'Width?' });

  console.log('');
  const results = [];

  for (const t of plan) {
    console.log(`пишу 0x44:${hex2(t.pp)} = ${t.to} (было ${t.from}, ${t.name})`);
    await writeOne(t.pp, t.to);
    await sleep(1500);

    const after = await freshSnapshot();
    const got = after.get(hex2(t.pp));
    const ok = got === t.to;
    console.log(`  0x44:${hex2(t.pp)}: ${t.from} -> ${t.to} -> ${got}  ${ok ? 'ПРИНЯТО' : 'нет'}`);
    results.push({ ...t, got, ok });

    if (ok) {
      console.log(`  возвращаю ${t.from}…`);
      await writeOne(t.pp, t.from);
      await sleep(1200);
      const back = await freshSnapshot();
      console.log(`  откат: ${back.get(hex2(t.pp)) === t.from ? 'ОК' : 'ПРОВЕРЬ'}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  console.log(`ИТОГ: ${passed} из ${results.length}`);
  if (passed === results.length) {
    console.log('Все четыре тега пишутся через HID — реверб управляется');
    console.log('без MCC, карта закрыта.');
  } else if (passed === 0) {
    console.log('Ни один не пишется напрямую. Нужен другой путь.');
  } else {
    console.log('Часть пишется — разбирать по одному.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
