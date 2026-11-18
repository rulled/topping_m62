/**
 * КЛИК БЕЗ КУРСОРА по кнопке EQ — проверка что окно открывается
 * и курсор пользователя не двигается.
 */
import { clickNoCursor, mccHwnd } from '../ui-click.js';
import { findEqButton } from './find-eq-relative.js';
import { dumpTree } from './uia.js';
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
public class CP2 {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@
$p = New-Object CP2+POINT
[CP2]::GetCursorPos([ref]$p) | Out-Null
Write-Output ($p.X.ToString() + "," + $p.Y.ToString())
`;
  return psx(S);
}

const hasEq = () => dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));

const r = findEqButton('IN1');
if (!r.button) { console.log('кнопка EQ не найдена'); process.exit(1); }
console.log(`кнопка EQ: [${r.button.i}] (${r.button.lx},${r.button.ly})`);
console.log(`HWND: ${mccHwnd()}`);

const cur0 = cursorPos();
console.log(`курсор ДО: ${cur0}\n`);

console.log('--- одиночный клик (PostMessage) ---');
try { console.log('  ' + clickNoCursor(r.button.lx, r.button.ly)); } catch (e) { console.log('  ' + e.message.slice(0, 140)); }
await sleep(2500);
const cur1 = cursorPos();
console.log(`  курсор: ${cur1}  ${cur1 === cur0 ? '✓ не двигался' : '✗ сдвинулся'}`);
console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);

if (!hasEq()) {
  console.log('\n--- двойной клик (PostMessage) ---');
  try { console.log('  ' + clickNoCursor(r.button.lx, r.button.ly, { double: true })); } catch (e) { console.log('  ' + e.message.slice(0, 140)); }
  await sleep(3000);
  const cur2 = cursorPos();
  console.log(`  курсор: ${cur2}  ${cur2 === cur0 ? '✓ не двигался' : '✗ сдвинулся'}`);
  console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);
}

if (hasEq()) {
  const t = dumpTree();
  const dials = t.items.filter((x) => /Dial/.test(x.cls ?? '') && x.lx > 1600);
  const combos = t.items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? ''));
  console.log(`\n  в окне EQ: диал'ов ${dials.length}, комбобоксов типа ${combos.length}`);
}
