/**
 * Проверка dial'а [331] (1013,699) — предполагаемый OTG input.
 * Возможно, не реагирует, потому что OTG выключен.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const otg = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  return { gain: i.Input_OTGIN?.GAIN, fx: i.Effect_Integration?.OtgLevel, mute: i.Input_OTGIN?.MUTE };
};

function scaleVal() {
  try {
    const raw = ps(PRELUDE + 'Write-Output $script:scale').trim();
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1.75;
  } catch { return 1.75; }
}
const S = scaleVal();

function drag(x, y, dy, up = true) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSDR {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSDR]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 250
[MSDR]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 150
for ($i=1; $i -le 10; $i++) {
  [MSDR]::SetCursorPos(${px}, ${py} + [int]((${dy} / 10) * $i))
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 150
[MSDR]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

function wheel(x, y, n, up = true) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSWH4 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSWH4]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${n}; $i++) {
  [MSWH4]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 50
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

console.log('OTG сейчас:', JSON.stringify(otg()));

// проверим, есть ли dial вообще на этом месте
const { items } = dumpTree();
const d331 = items.find((x) => String(x.i) === '331');
console.log(`dial [331]: ${d331 ? d331.cls + ' (' + d331.lx + ',' + d331.ly + ')' : 'НЕ НАЙДЕН'}`);

const allDials = items.filter((x) => /Dial/.test(x.cls ?? ''));
console.log(`\nвсе dial'ы:`);
for (const d of allDials) console.log(`  [${d.i}] ${d.cls} (${d.lx},${d.ly})`);

console.log('\n=== пробую КОЛЕСО на [331] ===');
wheel(1013, 699, 5, true);
await sleep(1800);
console.log('  после колеса:', JSON.stringify(otg()));

console.log('\n=== пробую DRAG на [331] ===');
drag(1013, 699, -40, true);
await sleep(1800);
console.log('  после drag:', JSON.stringify(otg()));

console.log('\n=== пробую колесо на [331] вниз ===');
wheel(1013, 699, 5, false);
await sleep(1800);
console.log('  после колеса вниз:', JSON.stringify(otg()));

// вернём значения
console.log('\n=== ВЫВОД ===');
console.log('Если OTG не меняется — либо dial заблокирован, либо OTG выключен.');
