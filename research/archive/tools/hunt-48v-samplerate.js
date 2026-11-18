/**
 * ПОИСК 48V И SAMPLE RATE В HID — широкий перебор.
 *
 * ═══ ЧТО ИЩЕМ ═══
 *
 *   48V (фантомное питание) — сейчас только в INI, в HID не найдено.
 *   Sample rate / buffer size — вообще нигде, кроме окна MCC.
 *
 * ═══ ПОЧЕМУ ПРОШЛЫЙ ПОИСК МОГ ПРОМАХНУТЬСЯ ═══
 *
 * `probe-48v.js` смотрел только семейства 0x21 (IN1) и 0x22 (IN2)
 * и только те свойства, что приходят сами. Но:
 *
 *   1. 48V может жить в другом семействе (0x11 — настройки, 0x12,
 *      0x2x — входы).
 *   2. Устройство может отдавать его только при включённом
 *      состоянии — то есть пока 48V = 0, тега может не быть.
 *   3. Снимок плавает: 10 тегов приходят не в каждой сессии
 *      (probe-dump-stability.js). Один снимок ничего не доказывает.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Собирает ОБЪЕДИНЕНИЕ тегов из нескольких сессий — так компенсируется
 * плавание. Затем печатает ВСЕ известные и неизвестные адреса с их
 * значениями, чтобы глазами найти кандидатов на 0/1 (48V) и на
 * 44100/48000 (sample rate).
 *
 * Запуск: node src/tools/hunt-48v-samplerate.js
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
const SESSIONS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 18000) {
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

/**
 * Что уже расшифровано. Нужно, чтобы отделить известное от
 * кандидатов.
 */
const KNOWN = {
  '11:01': 'handshake',
  '11:04': '? (настройка)',
  '11:08': 'save preset №',
  '11:0e': 'load preset №',
  '11:18': 'счётчик сессий',
  '11:19': '?',
  '11:1a': '?',
  '11:1b': '?',
  '11:1c': 'состояние порта',
  '11:1d': 'режим (смена)',
  '11:1e': '?',
  '11:22': 'MainButtonSingle',
  '11:23': 'MainButtonDouble',
  '11:25': '?',
  '12:01': '?',
  '12:04': '?',
  '12:05': '?',
  '12:06': '?',
  '21:01': 'метр IN1',
  '21:04': 'громкость MIC-1',
  '21:06': 'джек IN1',
  '22:04': 'громкость MIC-2',
  '22:06': 'джек IN2',
  '23:04': 'громкость AUX',
  '23:06': 'джек AUX',
  '25:04': 'громкость BT',
  '25:06': 'джек BT',
  '27:04': 'громкость OTG',
  '31:15': 'метр out1',
  '32:15': 'метр out2',
  '33:15': 'метр Mix B L',
  '34:15': 'метр Mix B R',
  '35:15': 'метр Mix C L',
  '36:15': 'метр Mix C R',
  '39:01': 'метр 39_1',
  '39:02': 'метр 39_2',
  '43:01': 'ducking threshold',
  '43:02': 'ducking attack',
  '43:03': 'ducking reduction',
  '43:04': 'ducking release',
  '43:05': 'ducking mask lo',
  '43:06': 'ducking mask hi',
  '43:07': 'ducking switch',
  '44:01': 'FX IN1 level',
  '44:02': 'FX IN2 level',
  '44:03': 'FX AUX level',
  '44:04': 'FX BT level',
  '44:05': 'FX OTG level',
  '44:06': 'NC уровень',
  '44:07': 'NC тип',
  '44:08': 'Reverb DryWet',
  '44:09': 'Reverb Room',
  '44:0a': 'Reverb Decay',
  '44:0b': 'Reverb тип',
  '44:0c': 'MuteFX',
  '44:0d': 'метр FX in',
  '44:0e': 'метр FX out',
  '44:0f': 'Reverb Width',
  '46:01': 'компрессор switch',
  '46:02': 'threshold',
  '46:03': 'ratio',
  '46:04': 'attack',
  '46:05': 'release',
  '46:06': 'gain',
  '46:07': 'gainAuto',
  '46:08': 'mix',
  '46:09': 'метр comp9',
  '46:0a': 'метр comp10',
  '46:0c': 'метр comp12',
  '46:0d': 'метр comp13',
  '61:01': 'метр OTG out L',
  '61:03': 'громкость OTG out',
  '62:01': 'метр OTG out R',
  '62:02': 'селектор OTG',
  '62:03': 'громкость OTG',
  '62:04': 'mute OTG',
  '62:06': 'джек OTG',
  '63:01': 'метр HP L',
  '63:03': 'громкость HP',
  '64:01': 'метр HP R',
  '64:02': 'селектор HP',
  '64:03': 'громкость HP',
  '64:04': 'mute HP',
  '64:06': 'джек HP',
  '9b:0b': 'метр EQ',
  '9b:0d': 'EQ IN1 gain',
  '9b:0e': 'EQ IN2 gain',
  '9b:0f': 'EQ IN1 switch',
  '9b:10': 'EQ IN2 switch',
  '9b:12': 'EQ IN1 param2',
  '9b:13': 'EQ IN2 param2',
};

async function main() {
  console.log(`собираю объединение из ${SESSIONS} сессий…\n`);

  const merged = new Map();
  const perSession = [];
  for (let i = 1; i <= SESSIONS; i++) {
    const s = await snap();
    perSession.push(s.size);
    for (const [k, v] of s) merged.set(k, v);
    console.log(`  сессия ${i}: ${s.size} тегов`);
    await sleep(2000);
  }
  console.log(`\n  объединение: ${merged.size} уникальных адресов`);
  console.log(`  (размеры по сессиям: ${perSession.join(', ')})\n`);

  const keys = [...merged.keys()].sort((a, b) => {
    const [ta, pa] = a.split(':').map((x) => parseInt(x, 16));
    const [tb, pb] = b.split(':').map((x) => parseInt(x, 16));
    return ta - tb || pa - pb;
  });

  // --- кандидаты на 48V: значения 0 или 1 ---
  console.log('='.repeat(70));
  console.log('КАНДИДАТЫ НА 48V (значение 0 или 1)');
  console.log('='.repeat(70));
  const binary = keys.filter((k) => merged.get(k) === 0 || merged.get(k) === 1);
  for (const k of binary) {
    const known = KNOWN[k];
    const mark = known ? '  ' : '??';
    console.log(`${mark} 0x${k} = ${merged.get(k)}   ${known ?? 'НЕИЗВЕСТНО'}`);
  }
  const unknownBinary = binary.filter((k) => !KNOWN[k]);
  console.log(`\n  неизвестных среди них: ${unknownBinary.length}`);

  // --- кандидаты на sample rate ---
  console.log('\n' + '='.repeat(70));
  console.log('КАНДИДАТЫ НА SAMPLE RATE / BUFFER (значения 44100, 48000, 32, 64...)');
  console.log('='.repeat(70));
  const srValues = new Set([44100, 48000, 88200, 96000, 192000, 16, 24, 32, 64, 128, 256, 512, 1024]);
  let found = 0;
  for (const k of keys) {
    const v = merged.get(k);
    if (srValues.has(v)) {
      console.log(`  0x${k} = ${v}   ${KNOWN[k] ?? 'НЕИЗВЕСТНО'}`);
      found += 1;
    }
  }
  if (!found) console.log('  ничего похожего на частоту дискретизации');

  // --- все неизвестные адреса ---
  console.log('\n' + '='.repeat(70));
  console.log('ВСЕ НЕИЗВЕСТНЫЕ АДРЕСА');
  console.log('='.repeat(70));
  const unknown = keys.filter((k) => !KNOWN[k]);
  if (!unknown.length) {
    console.log('  все адреса расшифрованы');
  } else {
    for (const k of unknown) {
      console.log(`  0x${k} = ${merged.get(k)}`);
    }
  }

  // --- семейства ---
  console.log('\n' + '='.repeat(70));
  console.log('СЕМЕЙСТВА');
  console.log('='.repeat(70));
  const fam = new Map();
  for (const k of keys) {
    const f = k.slice(0, 2);
    fam.set(f, (fam.get(f) ?? 0) + 1);
  }
  for (const [f, n] of [...fam.entries()].sort()) {
    console.log(`  0x${f}: ${n}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
