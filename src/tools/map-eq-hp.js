/**
 * EQ НАУШНИКОВ: полоса → блок 0xa?.
 *
 * ═══ СТРУКТУРА ОКНА (измерена) ═══
 *
 * Окно EQ — ОТДЕЛЬНОЕ окно процесса, AutomationId начинается с
 * "QApplication.EQ_HP", а не с "MainWindow_M62".
 *
 * Дилы окна:
 *     x = 452, 534, 616, 698, 780, 862, 944, 1026, 1108, 1190   (10 колонок)
 *     y = 593 (Gain), 671 (Freq), 749 (Q)
 *
 * Итого 30 дилов — ровно 10 полос × 3 параметра. Совпадает с картинкой.
 *
 * ═══ ЧТО ПРОВЕРЯЕМ ═══
 *
 * Крутим Gain полосы 1 (i=35) и смотрим, какие теги 0xa? меняются.
 * Ожидаем 0xa1:03 и 0xa1:08 — если в блоке два канала.
 *
 * Запуск: node src/tools/map-eq-hp.js
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
const SNAPSHOT_MS = 7500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();
const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Дилы окна EQ: только те, что в QApplication.EQ_HP. */
function eqDials() {
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
    '  Write-Output ("D|" + $i + "|" + [int]$r.X + "|" + [int]$r.Y)',
    '}',
  ].join('\n');

  const out = ui(body);
  if (!out) return [];
  return out
    .split('\n')
    .filter((l) => l.startsWith('D|'))
    .map((l) => {
      const [, i, x, y] = l.split('|');
      return { i: Number(i), x: Number(x), y: Number(y) };
    });
}

/** Фокус + стрелки. */
function nudge(index, keys, times) {
  const ops = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    '$e.SetFocus()',
    'Start-Sleep -Milliseconds 300',
    'Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue',
  ];
  for (let i = 0; i < times; i += 1) {
    ops.push(`[System.Windows.Forms.SendKeys]::SendWait("${keys}")`);
    ops.push('Start-Sleep -Milliseconds 180');
  }
  ops.push('Write-Output "DONE"');
  return ui(ops.join('\n'));
}

let h;
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

async function snapshotHP() {
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
      if (f.target >= 0xa1 && f.target <= 0xab) {
        out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
      }
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
  console.log('=== дилы окна EQ_HP ===');
  const dials = eqDials();
  if (!dials.length) {
    console.log('  окно EQ не открыто. Открой и повтори.');
    process.exit(1);
  }

  const xs = [...new Set(dials.map((d) => d.x))].sort((a, b) => a - b);
  const ys = [...new Set(dials.map((d) => d.y))].sort((a, b) => a - b);
  console.log(`  колонок: ${xs.length} -> ${xs.join(', ')}`);
  console.log(`  рядов: ${ys.length} -> ${ys.join(', ')}`);
  console.log(`  всего дилов: ${dials.length}`);

  // полоса 1 = первый x, ряд Gain = первый y
  const gainY = ys[0];
  const band1 = dials.find((d) => d.x === xs[0] && d.y === gainY);
  const freqBand1 = dials.find((d) => d.x === xs[0] && d.y === ys[1]);

  console.log(`\nполоса 1: Gain i=${band1.i} (y=${gainY}), Freq i=${freqBand1?.i} (y=${ys[1]})`);

  // ─── тест 1: Gain полосы 1 ───
  console.log('\n=== снимок до ===');
  const before = await snapshotHP();
  console.log(`  тегов: ${before.size}`);
  console.log(`  0xa1: ${[1,2,3,4,5,6,7,8,9,10].map((p) => before.get(`a1:${hex2(p)}`)).join(' ')}`);

  console.log(`\n=== крутим Gain полосы 1 (i=${band1.i}) вверх 4 раза ===`);
  console.log(`  ${nudge(band1.i, '{UP}', 4)}`);
  await sleep(2500);

  const after = await snapshotHP();
  const ch = diff(before, after);
  console.log('\n  ИЗМЕНЕНИЯ:');
  if (!ch.length) {
    console.log('    нет');
  } else {
    for (const c of ch) console.log(`    ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО с полосой 1`);
  }

  // ─── возврат ───
  console.log('\n=== возврат Gain: 4 раза вниз ===');
  nudge(band1.i, '{DOWN}', 4);
  await sleep(2000);

  // ─── тест 2: Freq полосы 1 ───
  if (freqBand1) {
    const mid = await snapshotHP();
    console.log(`\n=== крутим Freq полосы 1 (i=${freqBand1.i}) вверх 3 раза ===`);
    console.log(`  ${nudge(freqBand1.i, '{UP}', 3)}`);
    await sleep(2500);

    const after2 = await snapshotHP();
    const ch2 = diff(mid, after2);
    console.log('\n  ИЗМЕНЕНИЯ:');
    if (!ch2.length) {
      console.log('    нет');
    } else {
      for (const c of ch2) console.log(`    ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО с частотой`);
    }

    console.log('\n=== возврат Freq: 3 раза вниз ===');
    nudge(freqBand1.i, '{DOWN}', 3);
    await sleep(2000);
  }

  // ─── итог ───
  const fin = await snapshotHP();
  console.log('\n=== итог ===');
  console.log(`  0xa1: ${[1,2,3,4,5,6,7,8,9,10].map((p) => fin.get(`a1:${hex2(p)}`)).join(' ')}`);
  let restored = 0;
  for (const [k, v] of before) if (fin.get(k) === v) restored += 1;
  console.log(`  совпадает с исходным: ${restored} из ${before.size}`);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
