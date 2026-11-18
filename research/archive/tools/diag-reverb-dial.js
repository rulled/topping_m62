/**
 * Диагностика: почему nudgeReverb не сработал?
 * Проверяем активное окно, состояние реверба, видимость dial'ов.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const fg = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class FG2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
}
'@
$h = [FG2]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[FG2]::GetWindowText($h, $sb, 256) | Out-Null
Write-Output $sb.ToString()
`;

try {
  console.log('активное окно:', ps(fg).trim());
} catch (e) {
  console.log('не удалось получить окно:', e.message.slice(0, 80));
}

const w = findActiveWorkspace();
const e = readWorkspace(w.path).Effect_Integration ?? {};
console.log(`\nworkspace: ${w.mode}/${w.name}`);
console.log(`ReverbType: ${e.ReverbType}`);
console.log(`DryWetStudio: ${e.DryWetStudio}`);
console.log(`DecayStudio: ${e.DecayStudio}`);
console.log(`WidthStudio: ${e.WidthStudio}`);
console.log(`ReverbStudio: ${e.ReverbStudio}`);

const { items } = dumpTree();
console.log(`\nэлементов в UI: ${items.length}`);

const dials = items.filter((x) => /Dial/.test(x.cls ?? ''));
console.log(`dial'ов: ${dials.length}`);
for (const d of dials) console.log(`  [${d.i}] ${d.cls} (${d.lx},${d.ly})`);

// проверяем, что dial реверба на месте
const target = dials.find((d) => Math.abs(d.lx - 1021) < 20 && Math.abs(d.ly - 1105) < 20);
console.log(`\ndial DryWet (1021,1105): ${target ? 'НАЙДЕН [' + target.i + ']' : 'НЕ НАЙДЕН'}`);

// масштаб DPI
try {
  const scale = Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.'));
  console.log(`DPI scale: ${scale}`);
  console.log(`физические координаты DryWet: (${Math.round(1021 / scale)}, ${Math.round(1105 / scale)})`);
} catch (err) {
  console.log('scale не получен:', err.message.slice(0, 60));
}
