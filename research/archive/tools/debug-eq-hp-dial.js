/**
 * ПОЧЕМУ СТРЕЛКИ НЕ МЕНЯЮТ ЗНАЧЕНИЯ ДИЛОВ EQ НАУШНИКОВ.
 *
 * ═══ СИМПТОМ ═══
 *
 * map-eq-hp.js: фокус на диле полосы 1 + 4 стрелки вверх -> теги НЕ
 * изменились. Значения 0xa1 остались 0 1 0 632 7070.
 *
 * У EQ входов (eq-control.js) стрелки работали. Значит у дилов
 * EQ наушников что-то иначе.
 *
 * ═══ ГИПОТЕЗЫ ═══
 *
 *   A. У дила есть RangeValuePattern, и стрелки не нужны — можно SetValue.
 *   B. У дила нет RangeValue, а стрелки требуют реального КЛИКА
 *      (фокус через SetFocus недостаточно).
 *   C. Значения меняются, но теги приходят ТОЛЬКО при переподключении
 *      (то есть снимок их не видит в той же сессии).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Печатает все паттерны дила.
 * 2. Пробует SetValue через RangeValue, если он есть.
 * 3. Если нет — делает реальный клик и потом стрелки.
 * 4. После каждого способа снимает теги и сравнивает.
 *
 * Запуск: node src/tools/debug-eq-hp-dial.js
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

/** Находит первый дил окна EQ_HP. */
function findDial() {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  $cls = [string]$e.Current.ClassName',
    '  if ($cls -notmatch "^Dial") { continue }',
    '  $a = [string]$e.Current.AutomationId',
    '  if (-not $a.StartsWith("QApplication.EQ_HP")) { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Width -le 0) { continue }',
    '  Write-Output ("FOUND|" + $i + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + [int]$r.Width)',
    '  exit 0',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n');
  const r = ui(body);
  if (!r || r === 'NOT_FOUND') return null;
  const [, i, x, y, w] = r.split('|');
  return { i: Number(i), x: Number(x), y: Number(y), w: Number(w) };
}

/** Все паттерны дила. */
function patterns(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$out = @()',
    '$names = @{',
    '  "RangeValue" = [System.Windows.Automation.RangeValuePattern]::Pattern',
    '  "Value" = [System.Windows.Automation.ValuePattern]::Pattern',
    '  "Toggle" = [System.Windows.Automation.TogglePattern]::Pattern',
    '  "Invoke" = [System.Windows.Automation.InvokePattern]::Pattern',
    '  "Selection" = [System.Windows.Automation.SelectionPattern]::Pattern',
    '}',
    'foreach ($k in $names.Keys) {',
    '  $p = $null',
    '  $ok = $e.TryGetCurrentPattern($names[$k], [ref]$p)',
    '  if ($ok) { Write-Output ("HAS " + $k) }',
    '  if ($ok -and $k -eq "RangeValue") {',
    '    $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '    Write-Output ("  value=" + $rv.Current.Value + " [" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "] ro=" + $rv.Current.IsReadOnly)',
    '  }',
    '}',
  ].join('\n');
  return ui(body);
}

/** SetValue через RangeValue. */
function setValue(index, value) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    `  $rv.SetValue([double]${value})`,
    '  Write-Output "SET_OK"',
    '} else { Write-Output "NO_RANGE" }',
  ].join('\n');
  return ui(body);
}

/** Реальный клик по координатам. */
function realClick(x, y) {
  const body = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class EClick {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    '\'@ -ErrorAction SilentlyContinue',
    `[EClick]::SetCursorPos(${x}, ${y})`,
    'Start-Sleep -Milliseconds 350',
    '[EClick]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[EClick]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Write-Output "CLICKED"',
  ].join('\n');
  return ui(body);
}

/** Стрелки. */
function arrows(keys, times) {
  const ops = ['Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue'];
  for (let i = 0; i < times; i += 1) {
    ops.push(`[System.Windows.Forms.SendKeys]::SendWait("${keys}")`);
    ops.push('Start-Sleep -Milliseconds 200');
  }
  ops.push('Write-Output "SENT"');
  return ui(ops.join('\n'));
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snap() {
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
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target >= 0xa1 && f.target <= 0xab) out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lastKeep = Date.now(); }
    await sleep(8);
  }
  return out;
}

function show(label, map) {
  console.log(`  ${label}: 0xa1 = ${[1,2,3,4,5,6,7,8,9,10].map((p) => map.get(`a1:${hex2(p)}`)).join(' ')}`);
}

function diff(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) !== b.get(k)) out.push(`${k}: ${a.get(k)} -> ${b.get(k)}`);
  }
  return out;
}

async function main() {
  const d = findDial();
  if (!d) { console.log('дил EQ_HP не найден'); process.exit(1); }
  console.log(`дил: i=${d.i} (${d.x},${d.y}) w=${d.w}`);

  console.log('\n=== паттерны ===');
  console.log(patterns(d.i));

  const base = await snap();
  show('до', base);

  // ─── способ A: RangeValue SetValue ───
  console.log('\n=== A: SetValue через RangeValue ===');
  console.log(`  ${setValue(d.i, 6)}`);
  await sleep(2500);
  let s = await snap();
  let ch = diff(base, s);
  console.log(`  изменения: ${ch.length ? ch.join('; ') : 'нет'}`);
  if (ch.length) { console.log('  <<< RangeValue РАБОТАЕТ'); }

  // вернуть
  if (ch.length) { setValue(d.i, 0); await sleep(1500); }

  // ─── способ B: реальный клик + стрелки ───
  console.log('\n=== B: реальный клик + стрелки ===');
  const b2 = await snap();
  console.log(`  ${realClick(d.x + Math.round(d.w / 2), d.y + Math.round(d.w / 2))}`);
  await sleep(600);
  console.log(`  ${arrows('{UP}', 4)}`);
  await sleep(2500);
  s = await snap();
  ch = diff(b2, s);
  console.log(`  изменения: ${ch.length ? ch.join('; ') : 'нет'}`);
  if (ch.length) { console.log('  <<< КЛИК+СТРЕЛКИ РАБОТАЮТ'); arrows('{DOWN}', 4); await sleep(1500); }

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
