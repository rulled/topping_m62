/**
 * ОТКРЫТИЕ ОКНА EQ — перебор способов с проверкой каждого.
 *
 * Все способы безопасны: EQ выключен, MUTE включён.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psx = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

const hasEq = () => dumpTree().items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));

function findEqBtn() {
  const { items } = dumpTree();
  return items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
    .sort((a, b) => a.ly - b.ly)[5] ?? null;
}

const eq = findEqBtn();
if (!eq) { console.log('кнопка EQ не найдена'); process.exit(1); }
console.log(`кнопка EQ: [${eq.i}] (${eq.lx},${eq.ly})`);
console.log(`окно EQ: ${hasEq() ? 'открыто' : 'закрыто'}\n`);

// координаты для мыши
const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;
const px = Math.round(eq.lx / scale);
const py = Math.round(eq.ly / scale);

// ── способ 1: двойной клик мышью с корректным DPI ──
console.log('--- 1. двойной клик (мышь) ---');
const S1 = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MG1 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MG1]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 400
[MG1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MG1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 120
[MG1]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MG1]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "sent"
`;
console.log('  ' + psx(S1));
await sleep(3500);
console.log(`  окно EQ: ${hasEq() ? 'ОТКРЫЛОСЬ' : 'нет'}`);

if (!hasEq()) {
  // ── способ 2: правый клик (контекстное меню) ──
  console.log('\n--- 2. правый клик (контекстное меню) ---');
  const S2 = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MG2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MG2]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 400
[MG2]::mouse_event(0x0008,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 100
[MG2]::mouse_event(0x0010,0,0,0,[IntPtr]::Zero)
Write-Output "sent"
`;
  console.log('  ' + psx(S2));
  await sleep(2000);
  const { items } = dumpTree();
  const menus = items.filter((x) => /QMenu/.test(x.cls ?? ''));
  console.log(`  QMenu элементов: ${menus.length}`);
  for (const m of menus) console.log(`    ${m.cls} (${m.lx},${m.ly}) "${(m.name || '').slice(0, 30)}"`);
  // закрываем меню
  psx('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{ESC}")');
  await sleep(800);
}

if (!hasEq()) {
  // ── способ 3: щёлк по заголовку "Input" или по подписи EQ ──
  console.log('\n--- 3. проверяю, есть ли подпись "EQ" в области Input ---');
  const { items } = dumpTree();
  const eqLabels = items.filter((x) => x.name && x.name.trim() === 'EQ');
  console.log(`  подписей "EQ": ${eqLabels.length}`);
  for (const l of eqLabels) console.log(`    [${l.i}] ${l.cls} (${l.lx},${l.ly})`);
}

console.log(`\nИТОГ: окно EQ ${hasEq() ? 'ОТКРЫТО' : 'закрыто'}`);
