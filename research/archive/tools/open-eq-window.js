/**
 * ПОЛНЫЙ ЦИКЛ: открыть окно EQ двойным кликом, разобрать, закрыть.
 *
 * Кнопка EQ для IN1 — ищем динамически по координатам рядом с подписью IN1.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Найти подпись IN1 и кнопку EQ под ней. */
function findEqButton() {
  const { items } = dumpTree();
  const in1 = items.find((x) => (x.name || '').trim() === 'IN1');
  if (!in1) return { error: 'подпись IN1 не найдена', items };

  // кнопка EQ: x совпадает с IN1 (±15), y в диапазоне in1.ly+100 .. in1.ly+400
  const candidates = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && Math.abs(x.lx - in1.lx) < 20
    && x.ly > in1.ly + 100 && x.ly < in1.ly + 420)
    .sort((a, b) => a.ly - b.ly);

  return { in1, candidates, items };
}

const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

function doubleClick(lx, ly) {
  const px = Math.round(lx / scale);
  const py = Math.round(ly / scale);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSDD {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSDD]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MSDD]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSDD]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MSDD]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSDD]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' }); } catch { /* */ }
}

const r = findEqButton();
if (r.error) { console.log('ERROR:', r.error); process.exit(1); }

console.log(`подпись IN1: (${r.in1.lx},${r.in1.ly})`);
console.log('кнопки под IN1:');
for (const c of r.candidates) {
  console.log(`  [${c.i}] (${c.lx},${c.ly})`);
}

// EQ — третья кнопка (после 48V и AUTO), но проверим по порядку
// На скриншоте: 48V, AUTO, EQ, DUCKING
const eqBtn = r.candidates[2] ?? r.candidates[1];
if (!eqBtn) { console.log('кнопка EQ не найдена'); process.exit(1); }
console.log(`\nпредполагаемая EQ: [${eqBtn.i}] (${eqBtn.lx},${eqBtn.ly})`);

console.log('\nдвойной клик для открытия окна...');
doubleClick(eqBtn.lx, eqBtn.ly);
await sleep(3000);

// проверяем, открылось ли окно
const after = dumpTree();
const hasEqWindow = after.items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
const typeCombos = after.items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? ''));
console.log(`  окно EQ открыто: ${hasEqWindow ? 'ДА' : 'нет'}`);
console.log(`  комбобоксов типа: ${typeCombos.length}`);
console.log(`  всего элементов: ${after.items.length}`);

if (!hasEqWindow) {
  console.log('\nокно не открылось — возможно, кнопка не та');
  process.exit(1);
}

console.log('\n=== ТИПЫ ФИЛЬТРОВ ===');
for (const c of typeCombos.sort((a, b) => a.lx - b.lx)) {
  const VAL = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${c.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${c.i}] (${c.lx},${c.ly}) = "${ps(VAL).trim()}"`);
}

console.log('\n=== ФАЙЛ ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log(`  EQ_IN1.Switch: ${i.EQ_IN1?.Switch}`);
for (const [k, v] of Object.entries(i.EQ_IN1 ?? {})) {
  if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
}
