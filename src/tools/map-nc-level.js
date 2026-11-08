/**
 * NC: значение дила через lineEditNoiseReduction.
 *
 * ═══ ОТКРЫТИЕ ═══
 *
 * У дила уровня NC (DialS1M5, Effect_NC.dialNoiseReduction) НЕТ
 * RangeValuePattern — только Value (пустой) и Invoke.
 * Поэтому стандартный путь чтения не работает.
 *
 * Но рядом есть QLineEdit с AutomationId
 * Effect_NC.lineEditNoiseReduction (i=150). У него ValuePattern есть,
 * и он показывает то же число (как у компрессора lineEditCompress
 * и реверба lineEditReverb).
 *
 * Значит: значение читаем из lineEdit, меняем через Invoke/стрелки
 * на диле (как в eq-control.js).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Читает lineEditNoiseReduction.
 * 2. Снимок 0x44.
 * 3. Меняет уровень через дил (фокус + стрелки).
 * 4. Снимок заново, находит связанный тег.
 * 5. Возвращает.
 *
 * Запуск: node src/tools/map-nc-level.js
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
const SNAPSHOT_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Читает текст из QLineEdit по окончанию AutomationId. */
function readLineEdit(tail) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    `  if (-not ([string]$e.Current.AutomationId).EndsWith("${tail}")) { continue }`,
    '  $p = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '    Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '    exit 0',
    '  }',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  const r = ui(body);
  return !r || r === 'NOT_FOUND' ? null : r;
}

/** Ставит фокус на элемент по окончанию AutomationId. */
function focusByTail(tail) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    `  if (-not ([string]$e.Current.AutomationId).EndsWith("${tail}")) { continue }`,
    '  $e.SetFocus()',
    '  Write-Output "OK"',
    '  exit 0',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  return ui(body);
}

/** Шлёт стрелки через SendKeys. */
function pressKeys(keys) {
  const body = [
    'Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue',
    `[System.Windows.Forms.SendKeys]::SendWait("${keys}")`,
    'Write-Output "SENT"',
  ].join('\n');
  return ui(body);
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshot44() {
  try { h.close(); } catch { /* ok */ }
  await sleep(900);
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) throw new Error('M62 не найден');
  h = new HID.HID(dev.path);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(380);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(150);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
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
      if (f.target === 0x44) out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  return out;
}

function diff(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const out = [];
  for (const k of [...keys].sort()) {
    if (before.get(k) !== after.get(k)) {
      out.push({ tag: k, from: before.get(k), to: after.get(k) });
    }
  }
  return out;
}

async function main() {
  console.log('=== чтение lineEditNoiseReduction ===');
  const txt = readLineEdit('dialNoiseReduction'.replace('dial', 'lineEdit'));
  console.log(`  текст: [${txt ?? 'не найден'}]`);

  console.log('\n=== снимок 0x44 до ===');
  const before = await snapshot44();
  for (const [k, v] of [...before.entries()].sort()) console.log(`  ${k} = ${v}`);

  // ─── меняем уровень через дил ───
  console.log('\n=== меняем уровень: фокус + 5 стрелок вверх ===');
  console.log(`  фокус: ${focusByTail('dialNoiseReduction')}`);
  for (let i = 0; i < 5; i += 1) {
    pressKeys('{UP}');
    await sleep(180);
  }
  await sleep(2500);
  console.log(`  текст после: [${readLineEdit('lineEditNoiseReduction') ?? '?'}]`);

  const after = await snapshot44();
  const ch = diff(before, after);
  if (!ch.length) {
    console.log('\n  теги 0x44 НЕ изменились');
  } else {
    console.log('\n  изменения:');
    for (const c of ch) console.log(`    ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО`);
  }

  // ─── возврат ───
  console.log('\n=== возврат: 5 стрелок вниз ===');
  focusByTail('dialNoiseReduction');
  for (let i = 0; i < 5; i += 1) {
    pressKeys('{DOWN}');
    await sleep(180);
  }
  await sleep(2000);
  console.log(`  текст после возврата: [${readLineEdit('lineEditNoiseReduction') ?? '?'}]`);

  const fin = await snapshot44();
  console.log('\n=== итог ===');
  for (const [k, v] of [...fin.entries()].sort()) {
    const orig = before.get(k);
    console.log(`  ${k} = ${v} ${orig === v ? 'ok' : `(было ${orig})`}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
