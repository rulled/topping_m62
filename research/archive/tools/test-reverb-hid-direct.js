/**
 * МОЖНО ЛИ ПИСАТЬ РЕВЕРБ НАПРЯМУЮ ЧЕРЕЗ HID?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * STATUS.md говорит: «запись реверба — только относительными шагами,
 * через UI». То есть нужен работающий MCC и UIAutomation. Это последний
 * блок, который не работает автономно.
 *
 * Но теги реверба ЧИТАЮТСЯ из HID (0x44:0x08..0x0f). Значит, возможно,
 * и пишутся. Раньше проверяли при работающем MCC — он откатывал запись.
 * Теперь MCC закрыт (или в трее), проверим чисто.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Проверяет, что наушники и OTG отключены, иначе отказывается.
 * Меняет ТОЛЬКО тип реверба (0x44:0x0b) и возвращает назад.
 * ReverbType в файле сейчас Bypass, но даже если нет — звука нет,
 * потому что выходы физически не подключены.
 *
 * Запуск: node src/tools/test-reverb-hid-direct.js
 *         node src/tools/test-reverb-hid-direct.js --write
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

const DO_WRITE = process.argv.includes('--write');
const VID = 0x152a;
const PID = 0x875c;

/** 0x44:PP -> имя параметра. Из tags.js и docs/EFFECTS.md. */
const REVERB = {
  0x08: 'dryWet',
  0x09: 'room/level',
  0x0a: 'decay',
  0x0b: 'type',
  0x0c: 'muteFx',
  0x0f: 'width',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 iface 4 не найден');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  /** Слушает ms, возвращает Map адрес -> значение. */
  const listen = async (ms) => {
    const out = new Map();
    const t0 = Date.now();
    let lastKeep = 0;
    let lastAnn = 0;
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
        if (f.target === 0x44) out.set(f.prop, f.value);
      }
      if (Date.now() - lastKeep >= 2000) {
        send(0x11, PP_SUBSCRIBE, 1);
        lastKeep = Date.now();
      }
      if (Date.now() - lastAnn >= 6000) {
        send(0x11, PP_ANNOUNCE, 1);
        lastAnn = Date.now();
      }
      await sleep(8);
    }
    return out;
  };

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(200);
  send(0x11, PP_ANNOUNCE, 1);

  // --- безопасность ---
  const jack = new Map();
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      let buf;
      try {
        buf = h.readTimeout(50);
      } catch {
        continue;
      }
      if (!buf || !buf.length) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target === 0x64 || f.target === 0x62) {
        jack.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
    }
  }
  const hpJack = jack.get('64:06');
  const otgJack = jack.get('62:06');
  console.log(`наушники подключены: ${hpJack ?? '?'}   OTG: ${otgJack ?? '?'}`);
  if (hpJack === 1 || otgJack === 1) {
    console.error('\nОСТАНОВ: наушники или OTG подключены — тест со звуком запрещён.');
    h.close();
    process.exit(2);
  }
  console.log('выходы отключены — безопасно\n');

  const show = (label, m) => {
    const parts = Object.keys(REVERB)
      .map(Number)
      .sort((a, b) => a - b)
      .map((p) => `${REVERB[p]}=${m.has(p) ? m.get(p) : '—'}`);
    console.log(`  ${label.padEnd(18)} ${parts.join('  ')}`);
  };

  const before = await listen(8000);
  show('до:', before);
  if (before.size === 0) {
    console.log('\n  реверб-теги не пришли вообще — проверить нечего');
    h.close();
    return;
  }

  if (!DO_WRITE) {
    console.log('\n  режим чтения. Добавь --write, чтобы проверить запись.');
    h.close();
    return;
  }

  // --- пишем тип реверба ---
  const PROP = 0x0b;
  const orig = before.get(PROP);
  if (orig === undefined) {
    console.log(`\n  0x44:0x0b не пришёл — не знаю исходное значение, стоп`);
    h.close();
    return;
  }
  const target = orig === 0 ? 1 : 0;
  console.log(`\n  пишу тип реверба 0x44:0x${hex2(PROP)} ${orig} -> ${target} …`);
  send(0x44, PROP, target);
  await sleep(1200);
  send(0x11, PP_ANNOUNCE, 1);
  const after = await listen(10000);
  show('после записи:', after);

  const accepted = after.get(PROP) === target;
  console.log(`\n  ПРИНЯТО: ${accepted ? 'ДА' : 'НЕТ'}`);

  console.log(`\n  возвращаю ${orig} …`);
  send(0x44, PROP, orig);
  await sleep(1200);
  send(0x11, PP_ANNOUNCE, 1);
  const back = await listen(8000);
  show('после отката:', back);
  console.log(`  откат: ${back.get(PROP) === orig ? 'ОК' : 'НЕ ОК (проверь вручную)'}`);

  h.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
