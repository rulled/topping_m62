/**
 * НАВИГАЦИЯ MCC: какие страницы есть и как переключаться.
 *
 * PageID в реестре = 3. Возможно, EQ на другой странице.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reg = () => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-ItemProperty -Path 'HKCU:\\Software\\TOPPING\\TOPPING Professional Control Center\\M62' -Name PageID -ErrorAction SilentlyContinue).PageID`],
    { encoding: 'utf8' }).trim();
  } catch { return '?'; }
};

console.log(`PageID сейчас: ${reg()}`);

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// все кнопки
const btns = items.filter((x) => x.cls === 'QPushButton');
console.log(`=== ВСЕ КНОПКИ (${btns.length}) ===`);
for (const b of btns.sort((a, c) => a.ly - c.ly || a.lx - c.lx)) {
  const nm = (b.name || '').replace(/\n/g, '/').slice(0, 24);
  console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) ${nm}`);
}

// вкладки/табы
console.log('\n=== ВКЛАДКИ (Tab / RadioButton / ToolButton) ===');
const tabs = items.filter((x) => /QTabBar|QRadioButton|QToolButton/i.test(x.cls ?? ''));
for (const t of tabs) {
  console.log(`  [${t.i}] ${t.cls} (${t.lx},${t.ly}) "${(t.name || '').slice(0, 24)}"`);
}

// меню
console.log('\n=== МЕНЮ (QMenuBar / QMenu) ===');
const menus = items.filter((x) => /QMenu/i.test(x.cls ?? ''));
for (const m of menus) {
  console.log(`  [${m.i}] ${m.cls} (${m.lx},${m.ly}) "${(m.name || '').slice(0, 24)}"`);
}
