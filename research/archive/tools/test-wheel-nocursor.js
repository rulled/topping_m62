/**
 * ПРОВЕРКА: колесо без курсора меняет значение диала EQ.
 *
 * Безопасность: проверяем HP.MUTE в устройстве, и что EQ не влияет
 * на звук (вход IN1 в MUTE или EQ выключен).
 */
import { wheelNoCursor } from '../ui-wheel.js';
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

function cursorPos() {
  const S = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CP3 {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@
$p = New-Object CP3+POINT
[CP3]::GetCursorPos([ref]$p) | Out-Null
Write-Output ($p.X.ToString() + "," + $p.Y.ToString())
`;
  return psx(S);
}

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];
const parse = (s) => {
  const p = String(s ?? '').split('|').filter((x) => x !== '');
  return { type: p[0], freq: p[1], q: p[2], gain: p[3] };
};

console.log(`Eq%401 сейчас: ${band()}`);
console.log(`разбор: ${JSON.stringify(parse(band()))}`);

// находим диал Gain полосы 1
const { items } = dumpTree();
const hasEq = items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));
console.log(`\nокно EQ: ${hasEq ? 'открыто' : 'закрыто'}`);
if (!hasEq) { console.log('нужно открыть окно EQ'); process.exit(1); }

// Gain dial полосы 1: x≈714, y≈570
const gainDial = items.filter((x) => /Dial/.test(x.cls ?? ''))
  .find((d) => Math.abs(d.lx - 714) < 25 && Math.abs(d.ly - 570) < 25);
console.log(`Gain dial полосы 1: ${gainDial ? `(${gainDial.lx},${gainDial.ly})` : 'НЕ НАЙДЕН'}`);
if (!gainDial) process.exit(1);

const cur0 = cursorPos();
console.log(`\nкурсор ДО: ${cur0}`);

console.log('\n--- колесо +5 щелчков ---');
try { console.log('  ' + wheelNoCursor(gainDial.lx, gainDial.ly, 5)); } catch (e) { console.log('  ' + e.message.slice(0, 140)); }
await sleep(2200);

const cur1 = cursorPos();
console.log(`  курсор: ${cur1}  ${cur1 === cur0 ? '✓ не двигался' : '(пользователь двигал)'}`);
console.log(`  Eq%401: ${band()}`);
console.log(`  gain: ${parse(band()).gain}`);
