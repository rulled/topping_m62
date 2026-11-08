/**
 * КНОПКА EQ НАЙДЕНА! Теперь:
 *   1) проверить через HID, что Switch реально включился
 *   2) двойной клик — открыть окно настроек EQ
 *   3) разобрать окно: типы фильтров, частота, Q, gain
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== 1. ПРОВЕРКА ЧЕРЕЗ HID ===');
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', () => {});
const seen = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen.set((m.target << 8) | m.prop, m.value);
});

dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]); // Load preset → EQ-теги
await sleep(6000);

console.log('EQ-теги в HID:');
for (const pp of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]) {
  const v = seen.get((0x91 << 8) | pp);
  if (v !== undefined) console.log(`  0x91:0x0${pp} = ${v}`);
}
console.log('переключатели 0x9b:');
for (const pp of [0x0f, 0x10, 0x12, 0x13]) {
  console.log(`  0x9b:0x${pp.toString(16)} = ${seen.get((0x9b << 8) | pp)}`);
}
dev.close();

console.log('\n=== 2. ДВОЙНОЙ КЛИК по кнопке EQ [155] ===');
const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;

const DOUBLE = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSDC {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
$px = [int](928 / ${scale})
$py = [int](276 / ${scale})
[MSDC]::SetCursorPos($px, $py)
Start-Sleep -Milliseconds 300
[MSDC]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSDC]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MSDC]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSDC]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "double-click sent"
`;
console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', DOUBLE], { encoding: 'utf8' }).trim());
await sleep(3000);

console.log('\n=== 3. ЧТО ПОЯВИЛОСЬ В UI ===');
const { items } = dumpTree();
console.log(`элементов: ${items.length}`);

// ищем новое окно
const WINS = String.raw`
Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("PID=" + $_.Id + " title='" + $_.MainWindowTitle + "'")
}
`;
console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', WINS], { encoding: 'utf8' }).trim());

// ищем подписи, связанных с EQ
console.log('\nвсе подписи:');
for (const l of items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).slice(0, 55)) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.slice(0, 30)}"`);
}

// комбобоксы (тип фильтра?)
console.log('\nкомбобоксы:');
const combos = items.filter((x) => /ComboBox/.test(x.cls ?? ''));
for (const c of combos) {
  console.log(`  [${c.i}] ${c.cls} (${c.lx},${c.ly})`);
}

// слайдеры
console.log('\nслайдеры:');
const sliders = items.filter((x) => x.cls === 'QSlider');
for (const s of sliders) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${s.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NP" }',
  ].join('\n');
  console.log(`  [${String(s.i).padStart(3)}] (${String(s.lx).padStart(4)},${String(s.ly).padStart(4)}) ${ps(RAW).trim()}`);
}

console.log('\n=== файл ===');
const i = readWorkspace(findActiveWorkspace().path);
console.log('  EQ_IN1.Switch:', i.EQ_IN1?.Switch);
