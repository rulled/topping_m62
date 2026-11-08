/**
 * ПРОВЕРКА: клик без движения курсора.
 *
 * Запоминаем позицию курсора, кликаем через PostMessage,
 * проверяем что курсор не сдвинулся И окно EQ открылось.
 */
import { clickNoCursor } from '../ui-click.js';
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

/** Текущая позиция курсора. */
function cursorPos() {
  const S = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CP {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@
$p = New-Object CP+POINT
[CP]::GetCursorPos([ref]$p) | Out-Null
Write-Output ($p.X.ToString() + "," + $p.Y.ToString())
`;
  return psx(S);
}

const before = cursorPos();
console.log(`курсор ДО: ${before}`);

const { items } = dumpTree();
const col = items.filter((x) => /QPushButton/.test(x.cls ?? '')
  && x.lx > 100 && x.lx < 145 && x.ly > 100 && x.ly < 340)
  .sort((a, b) => a.ly - b.ly);
const eqBtn = col[5];
console.log(`кнопка EQ: [${eqBtn?.i}] (${eqBtn?.lx},${eqBtn?.ly})`);

const hasEq = () => dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));

console.log(`\nокно EQ до клика: ${hasEq() ? 'открыто' : 'закрыто'}`);

console.log('\n--- клик через PostMessage (одинарный) ---');
try {
  console.log('  ' + clickNoCursor(eqBtn.lx, eqBtn.ly));
} catch (e) {
  console.log('  ошибка:', e.message.slice(0, 120));
}
await sleep(2500);
const after1 = cursorPos();
console.log(`  курсор ПОСЛЕ: ${after1}  ${after1 === before ? '✓ НЕ СДВИНУЛСЯ' : '✗ СДВИНУЛСЯ'}`);
console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);

if (!hasEq()) {
  console.log('\n--- двойной клик через PostMessage ---');
  try {
    console.log('  ' + clickNoCursor(eqBtn.lx, eqBtn.ly, { double: true }));
  } catch (e) {
    console.log('  ошибка:', e.message.slice(0, 120));
  }
  await sleep(3000);
  const after2 = cursorPos();
  console.log(`  курсор: ${after2}  ${after2 === before ? '✓ НЕ СДВИНУЛСЯ' : '✗ СДВИНУЛСЯ'}`);
  console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);
}

console.log(`\nИТОГ: курсор ${cursorPos() === before ? 'не двигался' : 'ДВИГАЛСЯ'}, окно EQ ${hasEq() ? 'открыто' : 'закрыто'}`);
