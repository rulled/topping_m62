/**
 * ВЛИЯЕТ ЛИ ОТКРЫТОЕ ОКНО EQ НА ЧТЕНИЕ ТЕГОВ.
 *
 * ═══ СИМПТОМ ═══
 *
 * При открытом окне EQ наушников снимок даёт 27 адресов вместо 177.
 * Блок 0xa1 не приходит вовсе.
 *
 * Возможные причины:
 *   A. Окно EQ — модальное, MCC приостанавливает опрос устройства.
 *   B. Окно EQ забирает HID-канал себе (эксклюзивное открытие).
 *   C. Просто тайминг: при открытом окне дамп идёт ещё позже.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Снимок с открытым окном (долгий, 25 с).
 * 2. Закрывает окно EQ.
 * 3. Снимок снова.
 * 4. Сравнивает.
 *
 * Запуск: node src/tools/test-eq-window-blocks.js
 */

import { ps, PRELUDE } from './uia.js';

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
const ui = (body) => ps(PRELUDE + body).trim();
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Окно EQ открыто? */
function eqOpen() {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "CLOSED"; exit 0 }',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'if ($e) { Write-Output "OPEN" } else { Write-Output "CLOSED" }',
  ].join('\n');
  return ui(body) === 'OPEN';
}

/** Закрыть окно EQ через WindowPattern. */
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

async function snap(listenMs, gapMs, label) {
  await sleep(gapMs);
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const state = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  let firstA1 = null;
  while (Date.now() - t0 < listenMs) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      state.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      if (firstA1 === null && f.target === 0xa1) firstA1 = Date.now() - t0;
    }
    if (Date.now() - lastKeep >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lastKeep = Date.now(); }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  const a1 = [...state.keys()].filter((k) => k.startsWith('a1:')).length;
  console.log(
    `  ${label}: ${state.size} адресов, 0xa1 ${a1} тегов` +
      (firstA1 !== null ? `, первый на ${firstA1} мс` : ''),
  );
  return state;
}

async function main() {
  console.log(`окно EQ открыто: ${eqOpen()}`);

  console.log('\n=== снимок С ОТКРЫТЫМ окном (25 с) ===');
  await snap(25000, 5200, 'с окном');

  console.log('\n=== закрываю окно EQ ===');
  console.log(`  ${closeEq()}`);
  await sleep(2500);
  console.log(`  окно EQ открыто: ${eqOpen()}`);

  console.log('\n=== снимок БЕЗ окна (18 с) ===');
  await snap(18000, 5200, 'без окна');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
