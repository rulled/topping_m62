/**
 * ЗАПИСЬ EQ НАУШНИКОВ ПРИ ОТКРЫТОМ ОКНЕ — с достаточным окном.
 *
 * ═══ ЧТО ВЫЯСНИЛОСЬ ═══
 *
 * С ОТКРЫТЫМ окном EQ:  176 адресов, 0xa1 приходит на 10.8 с
 * БЕЗ окна:               30 адресов, 0xa1 НЕ приходит
 *
 * То есть окно EQ ПОМОГАЕТ: MCC держит сессию, устройство отдаёт полный
 * дамп, и наш handshake попадает в живую сессию.
 *
 * Мой первый тест (test-eq-hp-with-window.js) слушал 16 с и стартовал
 * сразу — не хватило. Нужно 25 с и пауза 5 с.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * Пишем при открытом окне, тремя способами, с окном 25 с.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP обязательно отключён — иначе СТОП. Значение 20 (тише, чем 40).
 *
 * Запуск: node src/tools/test-eq-hp-final.js
 */

import HID from 'node-hid';

import { ps, PRELUDE } from './uia.js';
import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
  PP_BULK_BEGIN,
  PP_SAVE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
/** При открытом окне EQ дамп идёт до 11 с — окно 26 с надёжно. */
const SNAPSHOT_MS = 26000;
const GAP_MS = 5200;
const SETTLE_MS = 3000;
/** После открытия окна EQ MCC занят ~20 с. Нужна пауза, иначе блок 0xa1 не приходит. */
const WARMUP_MS = 22000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();
const hex2 = (n) => n.toString(16).padStart(2, '0');

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

function eqOpen() {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "NO_ROOT"; exit 0 }',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'if ($e) { Write-Output "OPEN" } else { Write-Output "CLOSED" }',
  ].join('\n');
  return ui(body);
}

async function snap(label) {
  try { h.close(); } catch { /* ok */ }
  await sleep(GAP_MS);
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 не найден');
  h = new HID.HID(dev.path);
  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lastKeep = Date.now(); }
    await sleep(8);
  }
  const a1 = [...out.keys()].filter((k) => k.startsWith('a1:')).length;
  console.log(`  ${label}: ${out.size} адресов, 0xa1 ${a1} тегов`);
  return out;
}

function row(map) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => map.get(`a1:${hex2(p)}`)).join(' ');
}

async function main() {
  console.log(`окно EQ: ${eqOpen()}`);
  if (eqOpen() !== 'OPEN') {
    console.log('  окно EQ должно быть ОТКРЫТО — иначе 0xa1 не приходит.');
    console.log('  Открой его (двойной клик по кнопке EQ у HP) и повтори.');
    process.exit(1);
  }

  console.log('=== прогрев: ждём 22 с, чтобы MCC успокоился ===');
  await sleep(WARMUP_MS);

  console.log('\n=== снимок до ===');
  let s = await snap('до');
  const hp = s.get('64:06');
  console.log(`  HP джек = ${hp}`);
  console.log(`  0xa1: ${row(s)}`);

  if (hp !== 0) {
    console.log('\n  СТОП: наушники подключены. Отключи и повтори.');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const orig = s.get('a1:03');
  if (orig === undefined) {
    console.log('\n  блок 0xa1 не пришёл — прерываю');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }
  console.log(`  исходное 0xa1:03 = ${orig}`);

  const TARGET = orig === 20 ? 10 : 20;

  // ─── A: прямая ───
  console.log(`\n=== A: прямая запись 0xa1:03 = ${TARGET} ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(SETTLE_MS);
  s = await snap('A');
  const a = s.get('a1:03');
  console.log(`  стало ${a}  ${a === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── B: брекет ───
  console.log(`\n=== B: брекет + 0xa1:03 = ${TARGET} ===`);
  send(0x11, PP_BULK_BEGIN, 1);
  await sleep(250);
  send(0xa1, 0x03, TARGET);
  await sleep(250);
  send(0x11, PP_BULK_BEGIN, 0);
  await sleep(250);
  send(0x11, PP_ANNOUNCE, 1);
  await sleep(SETTLE_MS);
  s = await snap('B');
  const b = s.get('a1:03');
  console.log(`  стало ${b}  ${b === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── C: запись + save ───
  console.log(`\n=== C: запись + save-to-device ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(300);
  send(0x11, PP_SAVE, 1);
  await sleep(SETTLE_MS);
  s = await snap('C');
  const c = s.get('a1:03');
  console.log(`  стало ${c}  ${c === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  // ─── итог ───
  console.log('\n=== ИТОГ ===');
  console.log(`  A прямая:       ${a === TARGET ? 'РАБОТАЕТ' : 'нет'} (${a})`);
  console.log(`  B брекет:       ${b === TARGET ? 'РАБОТАЕТ' : 'нет'} (${b})`);
  console.log(`  C запись+save:  ${c === TARGET ? 'РАБОТАЕТ' : 'нет'} (${c})`);

  // ─── восстановление ───
  if (s.get('a1:03') !== orig) {
    console.log(`\n=== восстановление -> ${orig} ===`);
    send(0xa1, 0x03, orig);
    await sleep(400);
    send(0x11, PP_SAVE, 1);
    await sleep(SETTLE_MS);
    s = await snap('восст.');
  }
  console.log(`\nитоговое 0xa1: ${row(s)}`);
  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
