/**
 * МАППИНГ DIAL'ОВ РЕВЕРБА.
 *
 * В UI видны подписи: Dry, Wet, Room Size, Decay, Width.
 * Найдём их dial'ы и определим, какой параметр меняет каждый.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fx = () => {
  const w = findActiveWorkspace();
  const e = readWorkspace(w.path).Effect_Integration ?? {};
  return {
    level: e[`Reverb${e.ReverbType === 'BYPASS' ? 'Studio' : (e.ReverbType ?? 'Studio')}`] ?? e.ReverbStudio,
    dryWet: e[`DryWet${e.ReverbType === 'BYPASS' ? 'Studio' : (e.ReverbType ?? 'Studio')}`] ?? e.DryWetStudio,
    decay: e.DecayStudio,
    width: e.WidthStudio,
    room: e.RoomStudio ?? e.Room,
    reverbType: e.ReverbType,
  };
};

const scale = () => {
  try { return Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.')) || 1.75; } catch { return 1.75; }
};
const S = scale();

function wheelUp(x, y) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSW4 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSW4]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt 3; $i++) {
  [MSW4]::mouse_event(0x0800, 0, 0, 120, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 50
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

// все dial'ы и их позиции
const { items } = dumpTree();
const dials = items.filter((x) => /Dial/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx);
console.log(`dial'ов: ${dials.length}`);
for (const d of dials) console.log(`  [${d.i}] ${d.cls} (${d.lx},${d.ly})`);

console.log('\n=== подписи в области реверба (x 900-1200, y 1100-1450) ===');
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim() && x.lx > 850 && x.lx < 1250 && x.ly > 1100 && x.ly < 1450);
for (const l of labels.sort((a, b) => a.ly - b.ly)) {
  console.log(`  [${l.i}] (${l.lx},${l.ly}) "${l.name}"`);
}

console.log('\n=== исходное состояние ===');
console.log(' ', JSON.stringify(fx()));

console.log('\n=== перебираю dial\'ы колесом (3 щелчка) ===');
const hits = [];
for (const d of dials) {
  if (d.lx < 850 || d.lx > 1250) continue; // только зона реверба
  const b = fx();
  wheelUp(d.lx, d.ly);
  await sleep(1500);
  const a = fx();
  const diffs = Object.keys(a).filter((k) => String(a[k]) !== String(b[k]));
  if (diffs.length) {
    console.log(`  [${d.i}] (${d.lx},${d.ly}) -> ${diffs.map((k) => `${k}: ${b[k]}->${a[k]}`).join(', ')}`);
    hits.push({ dial: d, params: diffs });
  } else {
    console.log(`  [${d.i}] (${d.lx},${d.ly}) — ничего`);
  }
}

console.log('\n=== ИТОГ ===');
for (const h of hits) {
  console.log(`  (${h.dial.lx},${h.dial.ly}) -> ${h.params.join(', ')}`);
}
console.log('\nитоговое состояние:', JSON.stringify(fx()));
