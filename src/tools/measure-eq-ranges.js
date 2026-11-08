/**
 * ИЗМЕРЕНИЕ ДИАПАЗОНОВ EQ через dial'ы окна.
 *
 * СНАЧАЛА: убеждаемся, что выходы в MUTE (защита от звука).
 * Затем крутим Gain/Freq/Q полосы 1 до упора.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const psx = (cmd) => {
  try { return execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

// === ЗАЩИТА: MUTE на выходах ===
console.log('=== ЗАЩИТА ОТ ЗВУКА ===');
const w0 = findActiveWorkspace();
let ini0 = readWorkspace(w0.path);
ini0.Output_HP.MUTE = 'true';
ini0.Output_OTGOUT.MUTE = 'true';
writeWorkspace(w0.path, ini0);
console.log('  HP.MUTE = true, OTG.MUTE = true (в файле)');

// перезапуск MCC чтобы применилось
psx('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(4500);
psx('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);

const chk = readWorkspace(findActiveWorkspace().path);
console.log(`  проверка: HP.MUTE=${chk.Output_HP?.MUTE} OTG.MUTE=${chk.Output_OTGOUT?.MUTE}`);

// === открываем окно EQ ===
console.log('\n=== открываю окно EQ (двойной клик по кнопке EQ у IN1) ===');
const { items } = dumpTree();
const in1 = items.find((x) => (x.name || '').trim() === 'IN1');
if (!in1) { console.log('IN1 не найден'); process.exit(1); }

const eqBtns = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && Math.abs(x.lx - in1.lx) < 20 && x.ly > in1.ly + 100 && x.ly < in1.ly + 420)
  .sort((a, b) => a.ly - b.ly);
console.log(`  кнопок под IN1: ${eqBtns.length}`);
for (const b of eqBtns) console.log(`    [${b.i}] (${b.lx},${b.ly})`);

const eqBtn = eqBtns[2];
if (!eqBtn) { console.log('кнопка EQ не найдена'); process.exit(1); }

const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

const DBL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSQ {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSQ]::SetCursorPos([int](${eqBtn.lx} / ${scale}), [int](${eqBtn.ly} / ${scale}))
Start-Sleep -Milliseconds 300
[MSQ]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSQ]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MSQ]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSQ]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "dbl"
`;
psx(DBL);
await sleep(3000);

const after = dumpTree();
const hasEq = after.items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
console.log(`  окно EQ открыто: ${hasEq ? 'ДА' : 'нет'}, элементов: ${after.items.length}`);

if (!hasEq) process.exit(1);

// === читаем текущие значения полосы 1 ===
const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
console.log(`\n  Eq%401 сейчас: ${band()}`);

// === измеряем диапазоны через колесо на dial'ах ===
function wheel(lx, ly, n, up = true) {
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSWQ {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSWQ]::SetCursorPos([int](${lx} / ${scale}), [int](${ly} / ${scale}))
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${n}; $i++) {
  [MSWQ]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
}
`;
  psx(SCRIPT);
}

const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return { type: p[0], freq: p[1], q: p[2], gain: p[3] };
};

console.log('\n=== GAIN полосы 1: кручу вверх до упора ===');
for (let i = 0; i < 12; i++) {
  wheel(1746, 600, 10, true);
  await sleep(900);
  const g = parse(band()).gain;
  console.log(`  итерация ${i + 1}: gain=${g}`);
  if (i > 0) {
    const prev = parse(band()).gain;
    // проверим, не упёрлись ли
  }
}
const gMax = parse(band()).gain;
console.log(`  МАКС gain: ${gMax}`);

console.log('\n=== GAIN вниз до упора ===');
for (let i = 0; i < 12; i++) {
  wheel(1746, 600, 10, false);
  await sleep(900);
}
const gMin = parse(band()).gain;
console.log(`  МИН gain: ${gMin}`);

console.log(`\nИТОГ gain: ${gMin}..${gMax}`);
console.log(`файл: ${band()}`);
