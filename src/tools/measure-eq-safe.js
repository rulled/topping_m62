/**
 * ИЗМЕРЕНИЕ ДИАПАЗОНОВ EQ (Gain / Freq / Q) полосы 1.
 *
 * БЕЗОПАСНОСТЬ: сначала проверяем, что Output_HP замьючен в устройстве.
 * Если нет — прерываемся.
 *
 * Диал'ы в окне EQ (найдено §92):
 *   Gain: (1746,600), (1828,600), (1910,600), (1992,600)
 *   Freq: (1746,678), ...
 *   Q:    (1746,756), ...
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import HID from 'node-hid';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// ═══ ШАГ 1: ПРОВЕРКА БЕЗОПАСНОСТИ ═══
console.log('═══ 1. ПРОВЕРКА БЕЗОПАСНОСТИ ═══');
const hpMuted = await (async () => {
  const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
  const vp = found.find((d) => d.interface === 4);
  if (!vp) return null;
  const dev = new HID.HID(vp.path);
  const seen = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(4000);
  const v = seen.get(0x6406);
  dev.close();
  return v;
})();

console.log(`  HP.MUTE в устройстве: ${hpMuted}`);
if (hpMuted !== 1) {
  console.log('  ⚠ НАУШНИКИ НЕ ЗАМЬЮЧЕНЫ — прерываю, чтобы не было звука');
  process.exit(1);
}
console.log('  ✓ безопасно: наушники заглушены');

// ═══ ШАГ 2: ОТКРЫТЬ ОКНО EQ ═══
console.log('\n═══ 2. ОТКРЫВАЮ ОКНО EQ ═══');
function findEqButton() {
  const { items } = dumpTree();
  // Колонка IN1 в области Input. EQ — 6-я кнопка сверху (проверено §94).
  const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 145 && x.ly > 100 && x.ly < 340)
    .sort((a, b) => a.ly - b.ly);
  return col[5] ?? null;
}

let eqBtn = findEqButton();
if (!eqBtn) { console.log('  кнопка EQ не найдена'); process.exit(1); }
console.log(`  кнопка EQ: [${eqBtn.i}] (${eqBtn.lx},${eqBtn.ly})`);

const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

const DBL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSE1 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSE1]::SetCursorPos([int](${eqBtn.lx} / ${scale}), [int](${eqBtn.ly} / ${scale}))
Start-Sleep -Milliseconds 300
[MSE1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSE1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MSE1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSE1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
psx(DBL);
await sleep(3500);

let tree = dumpTree();
let hasEq = tree.items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
if (!hasEq) {
  console.log('  окно не открылось, пробую одиночный клик...');
  const SGL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSE2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSE2]::SetCursorPos([int](${eqBtn.lx} / ${scale}), [int](${eqBtn.ly} / ${scale}))
Start-Sleep -Milliseconds 250
[MSE2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSE2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  psx(SGL);
  await sleep(2500);
  tree = dumpTree();
  hasEq = tree.items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
}
console.log(`  окно EQ открыто: ${hasEq ? 'ДА' : 'НЕТ'}`);
if (!hasEq) process.exit(1);

// ═══ ШАГ 3: НАЙТИ ДИАЛЫ ═══
console.log('\n═══ 3. ИЩУ ДИАЛЫ В ОКНЕ EQ ═══');
const eqDials = tree.items.filter((x) => /Dial/.test(x.cls ?? '') && x.lx > 1600)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
console.log(`  диал'ов найдено: ${eqDials.length}`);
const rows = new Map();
for (const d of eqDials) {
  const k = Math.round(d.ly / 10) * 10;
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k).push(d);
}
for (const [y, list] of [...rows].sort((a, b) => a[0] - b[0])) {
  console.log(`  y≈${y}: ${list.length} шт — x: ${list.map((d) => d.lx).join(', ')}`);
}

const gainDial = eqDials.find((d) => Math.abs(d.ly - 600) < 25 && Math.abs(d.lx - 1746) < 30);
const freqDial = eqDials.find((d) => Math.abs(d.ly - 678) < 25 && Math.abs(d.lx - 1746) < 30);
const qDial = eqDials.find((d) => Math.abs(d.ly - 756) < 25 && Math.abs(d.lx - 1746) < 30);
console.log(`  Gain dial: ${gainDial ? `(${gainDial.lx},${gainDial.ly})` : 'не найден'}`);
console.log(`  Freq dial: ${freqDial ? `(${freqDial.lx},${freqDial.ly})` : 'не найден'}`);
console.log(`  Q dial:    ${qDial ? `(${qDial.lx},${qDial.ly})` : 'не найден'}`);

// ═══ ШАГ 4: ПРОЧИТАТЬ ИСХОДНОЕ ═══
const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return { type: p[0], freq: p[1], q: p[2], gain: p[3] };
};
console.log(`\n  Eq%401 исходно: ${band()}`);
console.log(`  разбор: ${JSON.stringify(parse(band()))}`);

// ═══ ШАГ 5: ПРОВЕРИТЬ, РЕАГИРУЮТ ЛИ ДИАЛЫ ═══
if (!gainDial) { console.log('Gain dial не найден — прерываю'); process.exit(1); }

function wheel(lx, ly, n, up = true) {
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSE3 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSE3]::SetCursorPos([int](${lx} / ${scale}), [int](${ly} / ${scale}))
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${n}; $i++) {
  [MSE3]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 45
}
`;
  psx(SCRIPT);
}

console.log('\n═══ 5. ТЕСТ: реагирует ли Gain dial? ═══');
const beforeGain = parse(band()).gain;
wheel(gainDial.lx, gainDial.ly, 5, true);
await sleep(1800);
const afterGain = parse(band()).gain;
console.log(`  Gain: ${beforeGain} -> ${afterGain}  ${String(beforeGain) !== String(afterGain) ? 'РЕАГИРУЕТ' : 'НЕ реагирует'}`);

if (String(beforeGain) === String(afterGain)) {
  console.log('\n  диал не реагирует — возможно, EQ выключен (Switch=0)');
  const t = dumpTree();
  const eqBtns = t.items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 2200 && x.ly > 240 && x.ly < 280);
  console.log(`  кнопок включения в окне EQ: ${eqBtns.length}`);
  for (const b of eqBtns) console.log(`    [${b.i}] (${b.lx},${b.ly})`);
}

console.log(`\n  текущее Eq%401: ${band()}`);
