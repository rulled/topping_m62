/**
 * МОЖНО ЛИ ВООБЩЕ ПИСАТЬ В СЕМЕЙСТВО 0x9b?
 *
 * ═══ ПОЧЕМУ ЭТО РЕШАЮЩИЙ ТЕСТ ═══
 *
 * Наблюдения противоречат друг другу:
 *   probe-9b12-range.js:  0 -> 0 принято, 2 -> 2 принято
 *   probe-9b-focused.js:  0 принято, 1 и 2 НЕ приняты (при EQ вкл)
 *
 * Это значит, что либо 0x9b записывается только в определённых
 * условиях, либо вообще НЕ записывается, а прошлые «принято» —
 * артефакт нестабильного дампа (известная проблема: 10 адресов
 * приходят через раз).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Берёт 0x9b:0f (EQ IN1 switch, значение заведомо 1) и пишет 0.
 * Затем читает длинным снимком. Если осталось 1 — семейство 0x9b
 * ТОЛЬКО ДЛЯ ЧТЕНИЯ. Это и есть ответ на вопрос про 0x9b:12/13:
 * их нельзя менять, значит это отражение состояния, а не параметр.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся и проверяется mute (0x64:04 = 1) ДЛИННЫМ
 * снимком — короткий даёт ложное «не применилось» (проверено:
 * тег приходит 1-2 раза за снимок).
 *
 * Запуск: node src/tools/prove-9b-readonly.js
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

/** Длинный снимок: редкие теги успевают прийти. */
async function snapshot(ms = 12000) {
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

async function write(frames) {
  const dev = findDev();
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(250);
  for (const [tt, pp, v] of frames) {
    send(tt, pp, v);
    await sleep(400);
  }
  await sleep(900);
  try {
    h.close();
  } catch {
    /* ok */
  }
}

async function main() {
  console.log('='.repeat(62));
  console.log('СЕМЕЙСТВО 0x9b: ТОЛЬКО ЧТЕНИЕ ИЛИ ЗАПИСЬ?');
  console.log('='.repeat(62));

  const s0 = await snapshot();
  const mute0 = s0.get('64:04');
  const jack = s0.get('64:06');
  console.log(`\nнаушники: jack=${jack} mute=${mute0}`);

  let needRestoreMute = false;
  if (jack === 1 && mute0 !== 1) {
    console.log('глушу наушники…');
    await write([[0x64, 0x04, 1]]);
    const chk = await snapshot();
    if (chk.get('64:04') !== 1) {
      console.log('НЕ заглушилось — ОСТАНОВ');
      process.exit(1);
    }
    console.log('  mute подтверждён (0x64:04 = 1)');
    needRestoreMute = true;
  } else if (jack === 1) {
    console.log('  уже заглушены — можно');
  } else {
    console.log('  наушники не подключены — безопасно');
  }

  const bogus = [
    ['9b:0f', '9b:10', '9b:12', '9b:13', '9b:0d', '9b:0e', '9b:0b'],
  ];

  console.log('\n' + '-'.repeat(62));
  console.log('ПИШУ В КАЖДЫЙ ТЕГ 0x9b И СМОТРЮ, ЧТО ЧИТАЕТСЯ НАЗАД');
  console.log('-'.repeat(62));

  const orig = {};
  for (const k of bogus[0]) orig[k] = s0.get(k);
  console.log('исходные значения:');
  for (const k of bogus[0]) console.log(`  0x${k} = ${orig[k]}`);

  const verdicts = [];
  for (const k of ['0f', '10', '12', '13']) {
    const cur = orig[`9b:${k}`];
    // пишем гарантированно другое значение из допустимых
    const target = cur === 0 ? 1 : 0;
    console.log(`\n0x9b:${k}: ${cur} -> пишу ${target}`);
    await write([[0x9b, parseInt(k, 16), target]]);
    const after = await snapshot();
    const got = after.get(`9b:${k}`);
    const accepted = got === target;
    console.log(`   читается: ${got}   ${accepted ? 'ПРИНЯТО (можно писать)' : 'НЕ принято'}`);
    verdicts.push({ tag: `0x9b:${k}`, from: cur, target, got, accepted });
    // возвращаем
    if (accepted) {
      await write([[0x9b, parseInt(k, 16), cur ?? 0]]);
    }
  }

  if (needRestoreMute) {
    await write([[0x64, 0x04, mute0 ?? 0]]);
    console.log('\nmute наушников возвращён');
  }

  console.log('\n' + '='.repeat(62));
  console.log('ВЕРДИКТ');
  console.log('='.repeat(62));
  const anyAccepted = verdicts.filter((v) => v.accepted);
  if (anyAccepted.length === 0) {
    console.log('  НИ ОДИН тег 0x9b не принимает запись.');
    console.log('  => Семейство 0x9b — ТОЛЬКО ДЛЯ ЧТЕНИЯ.');
    console.log('     Это отражение состояния (метры + флаги), а не параметры.');
    console.log('     Значит 0x9b:0x12/0x13 нельзя «выставить» — их можно');
    console.log('     только наблюдать. Для клиента они не нужны:');
    console.log('     реальное управление EQ идёт через 0x91..0x94.');
  } else {
    console.log(`  Пишутся: ${anyAccepted.map((v) => v.tag).join(', ')}`);
    console.log('  Остальные — только чтение.');
  }

  console.log('\nтаблица:');
  for (const v of verdicts) {
    console.log(`  ${v.tag.padEnd(10)} ${String(v.from).padStart(3)} -> ->> ${String(v.target).padStart(3)}  стало ${String(v.got).padStart(3)}  ${v.accepted ? 'ЗАПИСЬ' : 'только чтение'}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
