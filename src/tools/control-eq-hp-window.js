/**
 * КОНТРОЛЬНЫЙ ОПЫТ: нужен ли открытым окно EQ для записи?
 *
 * ═══ ЧТО ТОЛЬКО ЧТО ВЫЯСНИЛОСЬ ═══
 *
 * test-eq-hp-final.js (окно EQ ОТКРЫТО, прогрев 22 с):
 *     A прямая запись   0xa1:03  40 -> 20  ПРИНЯТО
 *     B брекет          0xa1:03  40 -> 20  ПРИНЯТО
 *     C запись+save     0xa1:03  40 -> 20  ПРИНЯТО
 *
 * Раньше (окно ЗАКРЫТО) те же записи не применялись.
 *
 * Но есть ПУТАНИЦА: в тех прошлых тестах снимок был НЕПОЛНЫМ (30 адресов,
 * 0xa1 не приходил вовсе), поэтому «не принято» могло быть просто
 * «не увидели».
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Закрываем окно EQ и пробуем запись с ПРАВИЛЬНЫМ таймингом снимка
 * (пауза 5 с, окно 26 с). Если 0xa1 приходит и запись применяется —
 * значит окно не нужно, дело было в тайминге.
 *
 * Если 0xa1 не приходит без окна — значит окно КРИТИЧНО (MCC держит
 * сессию), и это важное ограничение для нашей программы.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP проверяется: при подключённых наушниках СТОП.
 * Значение 30 (тише unity).
 *
 * Запуск: node src/tools/control-eq-hp-window.js
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
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const SNAPSHOT_MS = 26000;
const GAP_MS = 5200;
const SETTLE_MS = 3000;
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

function closeEq() {
  const body = [
    '$root = Get-MccRoot',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'if (-not $e) { Write-Output "NO_WINDOW"; exit 0 }',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.WindowPattern]$p).Close()',
    '  Write-Output "CLOSED"',
    '} else { Write-Output "NO_PATTERN" }',
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

async function main() {
  console.log(`окно EQ: ${eqOpen()}`);
  if (eqOpen() === 'OPEN') {
    console.log(`  закрываю: ${closeEq()}`);
    await sleep(3000);
  }
  console.log(`  теперь: ${eqOpen()}`);

  console.log('\n=== снимок БЕЗ окна (26 с) ===');
  let s = await snap('без окна');
  const hp = s.get('64:06');
  console.log(`  HP = ${hp}`);

  const hasA1 = [...s.keys()].some((k) => k.startsWith('a1:'));
  if (!hasA1) {
    console.log('\n  ВЫВОД: без открытого окна блок 0xa1 НЕ приходит.');
    console.log('  Значит окно EQ КРИТИЧНО для записи EQ наушников:');
    console.log('  MCC держит сессию, и только в ней устройство отдаёт/принимает 0xa?.');
    try { h.close(); } catch { /* ok */ }
    return;
  }

  if (hp !== 0) {
    console.log('\n  СТОП: наушники подключены');
    try { h.close(); } catch { /* ok */ }
    process.exit(1);
  }

  const orig = s.get('a1:03');
  console.log(`  0xa1:03 = ${orig}`);

  const TARGET = orig === 30 ? 10 : 30;
  console.log(`\n=== пишем 0xa1:03 = ${TARGET} БЕЗ окна ===`);
  send(0xa1, 0x03, TARGET);
  await sleep(SETTLE_MS);
  s = await snap('после записи');
  const got = s.get('a1:03');
  console.log(`  стало ${got}  ${got === TARGET ? 'ПРИНЯТО' : 'не принято'}`);

  console.log('\n=== ВЫВОД ===');
  if (got === TARGET) {
    console.log('  запись работает БЕЗ окна — окно не нужно, дело было в тайминге снимка');
  } else {
    console.log('  запись НЕ работает без окна — окно критично');
  }

  if (s.get('a1:03') !== orig) {
    console.log(`\nвосстановление -> ${orig}`);
    send(0xa1, 0x03, orig);
    await sleep(SETTLE_MS);
    s = await snap('восст.');
    console.log(`  0xa1:03 = ${s.get('a1:03')}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
