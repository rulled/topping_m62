/**
 * EQ НАУШНИКОВ: связь 10 полос UI с блоками 0xa1..0xaa.
 *
 * ═══ ОТКРЫТИЕ ═══
 *
 * В Prof-режиме устройство отдаёт 100 тегов 0xa1..0xaa — по 10 свойств
 * в каждом блоке. Это ровно 10 блоков.
 *
 * А окно EQ наушников содержит РОВНО 10 полос:
 *     EqWidgetIem: 10
 *     ComboBoxS1M3: 10   (тип фильтра каждой полосы)
 *     QCheckBox:   10    (вкл/выкл каждой полосы)
 *     DialS1M5:    32    (30 = 10 полос x 3 дила: gain/freq/Q, +2 прочих)
 *
 * Значит 0xa1..0xaa = EQ наушников, по блоку на полосу.
 * Структура блока повторяет EQ_IN:
 *     01 = вкл/выкл
 *     02 = тип фильтра
 *     03 = gain
 *     04 = частота
 *     05 = Q x 1000
 *     06..0a = вторая "полоса" внутри блока (как в EQ_IN)
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Находит окно EqualizerBase и его 10 полос.
 * 2. Меняет дил частоты у ОДНОЙ полосы.
 * 3. Смотрит, какой тег 0xa? изменился.
 * 4. Возвращает.
 *
 * Запуск: node src/tools/map-eq-hp-bands.js
 */

import HID from 'node-hid';

import { ps, PRELUDE, dumpTree } from './uia.js';
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

/** Все дилы окна EQ с их AutomationId и позицией. */
function eqDials() {
  const { items } = dumpTree();
  return items
    .filter((x) => x.cls === 'DialS1M5')
    .map((x) => ({ i: x.i, x: x.lx, y: x.ly }));
}

/** Полный AutomationId элемента по индексу. */
function autoIdOf(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if ($e) { Write-Output $e.Current.AutomationId } else { Write-Output "NO_ELEMENT" }',
  ].join('\n');
  return ui(body);
}

/** Фокус на элементе. */
function focus(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if ($e) { $e.SetFocus(); Write-Output "OK" } else { Write-Output "NO_ELEMENT" }',
  ].join('\n');
  return ui(body);
}

/** Стрелки. */
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

/** Снимок всех тегов 0xa1..0xab. */
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
  console.log('=== дилы окна EQ ===');
  const dials = eqDials();
  console.log(`  найдено: ${dials.length}`);

  // группируем по x — это колонки (полосы)
  const byX = {};
  for (const d of dials) {
    (byX[d.x] = byX[d.x] || []).push(d);
  }
  const cols = Object.keys(byX)
    .map(Number)
    .sort((a, b) => a - b);

  console.log(`  колонок (полос): ${cols.length}`);
  for (const x of cols) {
    const items = byX[x].sort((a, b) => a.y - b.y);
    const id0 = autoIdOf(items[0].i);
    const tail = id0.split('.').slice(-2).join('.');
    console.log(`    x=${String(x).padStart(4)}: ${items.length} дилов, y=${items.map((i) => i.y).join(',')}  ${tail}`);
  }

  if (!cols.length) {
    console.log('\nокно EQ не найдено. Открой его в MCC (двойной клик по кнопке EQ).');
    process.exit(1);
  }

  // ─── берём первую полосу, второй дил (частота) ───
  const firstCol = byX[cols[0]].sort((a, b) => a.y - b.y);
  if (firstCol.length < 2) {
    console.log('\nу полосы меньше двух дилов');
    process.exit(1);
  }
  const target = firstCol[1];
  const id = autoIdOf(target.i);
  console.log(`\nцель: i=${target.i} y=${target.y}  ${id.split('.').slice(-2).join('.')}`);

  console.log('\n=== снимок 0xa1..0xab до ===');
  const before = await snapshotHP();
  console.log(`  тегов: ${before.size}`);
  for (const [k, v] of [...before.entries()].slice(0, 12)) console.log(`    ${k} = ${v}`);

  // ─── меняем ───
  console.log(`\n=== фокус + 5 стрелок вверх на i=${target.i} ===`);
  console.log(`  фокус: ${focus(target.i)}`);
  for (let i = 0; i < 5; i += 1) {
    pressKeys('{UP}');
    await sleep(200);
  }
  await sleep(2500);

  const after = await snapshotHP();
  const ch = diff(before, after);
  if (!ch.length) {
    console.log('\n  теги НЕ изменились');
  } else {
    console.log('\n  ИЗМЕНЕНИЯ:');
    for (const c of ch) console.log(`    ${c.tag}: ${c.from} -> ${c.to}  <== СВЯЗАНО`);
  }

  // ─── возврат ───
  console.log('\n=== возврат: 5 стрелок вниз ===');
  focus(target.i);
  for (let i = 0; i < 5; i += 1) {
    pressKeys('{DOWN}');
    await sleep(200);
  }
  await sleep(2000);

  const fin = await snapshotHP();
  let restored = 0;
  for (const [k, v] of before) {
    if (fin.get(k) === v) restored += 1;
  }
  console.log(`  восстановлено ${restored} из ${before.size}`);

  try { h.close(); } catch { /* ok */ }
}

main().catch((e) => {
  console.error(e);
  try { h?.close(); } catch { /* ok */ }
  process.exit(1);
});
