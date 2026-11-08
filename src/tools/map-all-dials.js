/**
 * ПОЛНЫЙ МАППИНГ ВСЕХ DIAL'ОВ.
 *
 * Известны: 4 реверба (395,396,397,403), компрессор (376=thr, 381=gain).
 * Неизвестны: 283, 300, 311, 321, 331, 366.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readNum = (v) => (v === undefined ? null : Number(String(v).replace(',', '.')));

const state = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  const e = i.Effect_Integration ?? {};
  return {
    in1: i.Input_IN1?.GAIN, in2: i.Input_IN2?.GAIN, aux: i.Input_AUX?.GAIN,
    bt: i.Input_BT?.GAIN, otg: i.Input_OTGIN?.GAIN,
    fx1: e.Input1Level, fx2: e.Input2Level, fxAux: e.AuxLevel,
    fxBt: e.BluetoothLevel, fxOtg: e.OtgLevel,
    nred: e.NoiseReductionNC1, ntype: e.NoiseReductionType,
    thr: i.Compressor?.Threshold, gain: i.Compressor?.Gain,
    duck: i.Ducking?.Threshold,
  };
};

function scaleVal() {
  try {
    const raw = ps(PRELUDE + 'Write-Output $script:scale').trim();
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1.75;
  } catch { return 1.75; }
}
const S = scaleVal();

function wheel(x, y, notches, up = true) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSWX {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSWX]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${Math.abs(notches)}; $i++) {
  [MSWX]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 50
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

const { items } = dumpTree();
const dials = items.filter((x) => /Dial/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly || a.lx - b.lx);

const KNOWN = new Set(['395', '396', '397', '403', '376', '381']);

console.log(`dial'ов: ${dials.length}, scale=${S}\n`);
console.log('исходное:', JSON.stringify(state()), '\n');

console.log('=== ПЕРЕБОР НЕИЗВЕСТНЫХ DIAL\'ОВ (3 щелчка вверх) ===');
const found = [];
for (const d of dials) {
  if (KNOWN.has(String(d.i))) continue;
  const b = state();
  wheel(d.lx, d.ly, 3, true);
  await sleep(1600);
  const a = state();
  const diffs = Object.keys(a).filter((k) => String(a[k]) !== String(b[k]));
  if (diffs.length) {
    console.log(`  [${String(d.i).padStart(3)}] ${d.cls} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)}) -> ${diffs.map((k) => `${k}: ${b[k]}->${a[k]}`).join(', ')}`);
    found.push({ dial: d, params: diffs });
  } else {
    console.log(`  [${String(d.i).padStart(3)}] ${d.cls} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)}) — ничего`);
  }
}

console.log('\n=== ИТОГ ===');
for (const f of found) console.log(`  (${f.dial.lx},${f.dial.ly}) [${f.dial.i}] -> ${f.params.join(', ')}`);
console.log('\nитоговое:', JSON.stringify(state()));
