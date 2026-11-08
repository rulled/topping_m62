/**
 * СВЯЗЬ NC-КОНТРОЛОВ С ТЕГАМИ 0x44.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * В Mobile-режиме панель NC содержит:
 *     dialNoiseReduction       дил уровня подавления
 *     pushButtonNC1 / NC2      тип (классический / агрессивный)
 *     pushButtonBypassNoise    обход
 *
 * В потоке видно семейство 0x44 (7 тегов), и его значения меняются
 * между режимами. Гипотеза: это NC.
 *
 * ═══ ЧТО ДЕЛАЕТСЯ ═══
 *
 * 1. Снимок 0x44.
 * 2. Меняем ОДИН контрол через UI.
 * 3. Снимок 0x44 заново.
 * 4. Какой тег изменился — тот и связан с этим контролом.
 *
 * Возвращаем всё назад.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены. NC влияет на обработку входа, не на выход —
 * но всё равно меняем на небольшое значение и возвращаем.
 *
 * Запуск: node src/tools/map-nc-tags.js
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

/** Читает значение дила по AutomationId. */
function readDial(autoId) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if (-not ([string]$e.Current.AutomationId).EndsWith("' + autoId + '")) { continue }',
    '  $p = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '    $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '    Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum + "|" + $rv.Current.Maximum)',
    '    exit 0',
    '  }',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  const r = ui(body);
  if (!r || r === 'NOT_FOUND') return null;
  const [value, min, max] = r.split('|').map(Number);
  return { value, min, max };
}

/** Ставит значение дила. */
function setDial(autoId, value) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if (-not ([string]$e.Current.AutomationId).EndsWith("' + autoId + '")) { continue }',
    '  $p = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '    $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '    $rv.SetValue([double]' + value + ')',
    '    Write-Output "OK"',
    '    exit 0',
    '  }',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  return ui(body);
}

/** Нажимает кнопку по AutomationId. */
function clickButton(autoId) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if (-not ([string]$e.Current.AutomationId).EndsWith("' + autoId + '")) { continue }',
    '  $p = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '    ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '    Write-Output "OK"',
    '    exit 0',
    '  }',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  return ui(body);
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Снимок всех тегов 0x44. */
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
  const changes = [];
  for (const k of [...keys].sort()) {
    const a = before.get(k);
    const b = after.get(k);
    if (a !== b) changes.push({ tag: k, from: a, to: b });
  }
  return changes;
}

async function main() {
  console.log('=== исходное состояние 0x44 ===');
  const s0 = await snapshot44();
  for (const [k, v] of [...s0.entries()].sort()) console.log(`  ${k} = ${v}`);

  // ─── тест 0: подогреть — одно переключение, чтобы теги появились ───
  // ВАЖНО: при первом чтении 0x44:06 и 0x44:07 могут НЕ приходить.
  // Они появляются после того, как UI тронет NC. Поэтому сначала
  // переключаем NC туда-обратно, затем снимаем полноценный снимок.
  if (!s0.has('44:06')) {
    console.log('\n=== прогрев: тегов 44:06/44:07 нет, переключаю NC2->NC1 ===');
    clickButton('pushButtonNC2');
    await sleep(1200);
    clickButton('pushButtonNC1');
    await sleep(1500);
  }

  const base = await snapshot44();
  console.log('\n=== базовое состояние после прогрева ===');
  for (const [k, v] of [...base.entries()].sort()) console.log(`  ${k} = ${v}`);

  const dial = readDial('dialNoiseReduction');
  console.log(`\n  dialNoiseReduction: ${dial ? `${dial.value} [${dial.min}..${dial.max}]` : 'не найден'}`);

  // ─── тест 1: изменить уровень шумоподавления ───
  if (dial) {
    const target = dial.value === dial.min ? Math.min(dial.max, dial.min + 15) : dial.min;
    console.log(`\n=== тест: dialNoiseReduction ${dial.value} -> ${target} ===`);
    console.log(`  ${setDial('dialNoiseReduction', target)}`);
    await sleep(2500);

    const s1 = await snapshot44();
    const ch = diff(base, s1);
    if (!ch.length) {
      console.log('  теги 0x44 НЕ изменились');
    } else {
      for (const c of ch) console.log(`  ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО с уровнем NC`);
    }

    console.log(`\n  возврат dialNoiseReduction -> ${dial.value}`);
    setDial('dialNoiseReduction', dial.value);
    await sleep(2000);
  }

  // ─── тест 2: переключить тип NC1 / NC2 ───
  console.log('\n=== тест: тип NC (NC1 -> NC2) ===');
  const beforeType = await snapshot44();
  console.log(`  ${clickButton('pushButtonNC2')}`);
  await sleep(2500);
  const s2 = await snapshot44();
  const ch2 = diff(beforeType, s2);
  if (!ch2.length) {
    console.log('  теги 0x44 НЕ изменились');
  } else {
    for (const c of ch2) console.log(`  ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО с типом NC`);
  }

  console.log('\n  возврат на NC1');
  clickButton('pushButtonNC1');
  await sleep(2000);

  // ─── тест 3: bypass ───
  console.log('\n=== тест: bypass NC ===');
  const beforeBypass = await snapshot44();
  console.log(`  ${clickButton('pushButtonBypassNoise')}`);
  await sleep(2500);
  const s3 = await snapshot44();
  const ch3 = diff(beforeBypass, s3);
  if (!ch3.length) {
    console.log('  теги 0x44 НЕ изменились');
  } else {
    for (const c of ch3) console.log(`  ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО с bypass`);
  }

  console.log('\n  возврат bypass');
  clickButton('pushButtonBypassNoise');
  await sleep(2000);

  // ─── итог ───
  console.log('\n=== итог ===');
  const fin = await snapshot44();
  for (const [k, v] of [...fin.entries()].sort()) {
    const orig = base.get(k);
    const mark = orig === v ? 'ok' : `(в базовом было ${orig})`;
    console.log(`  ${k} = ${v} ${mark}`);
  }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
