/**
 * Восстановить Gain компрессора через колесо мыши (замкнутый контур).
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gain = () => {
  const ws = findActiveWorkspace();
  return Number(readWorkspace(ws.path).Compressor?.Gain);
};

const scale = () => {
  try { return Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.')) || 1.75; } catch { return 1.75; }
};
const S = scale();

function wheel(x, y, notches, up = true) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSG {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSG]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${notches}; $i++) {
  [MSG]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

const GAIN_DIAL = { x: 756, y: 1464 };
const TARGET = 0;

console.log(`Gain сейчас = ${gain()}, цель = ${TARGET}`);

let cur = gain();
let perNotch = null;

for (let iter = 1; iter <= 10; iter++) {
  cur = gain();
  const need = TARGET - cur;
  if (need === 0) {
    console.log(`\nитерация ${iter}: ${cur} — ЦЕЛЬ ДОСТИГНУТА`);
    break;
  }

  if (perNotch === null) {
    // калибровка: 3 щелчка
    const before = cur;
    wheel(GAIN_DIAL.x, GAIN_DIAL.y, 3, need > 0);
    await sleep(1200);
    const after = gain();
    perNotch = (after - before) / 3;
    console.log(`калибровка: ${before} -> ${after} за 3 щелчка = ${perNotch.toFixed(2)} ед/щелчок`);
    if (perNotch === 0) {
      console.log('колесо не действует');
      break;
    }
    continue;
  }

  const notches = Math.round(need / perNotch);
  if (notches === 0) {
    console.log(`итерация ${iter}: ${cur}, нужно ${need} — меньше одного щелчка`);
    break;
  }
  console.log(`итерация ${iter}: ${cur} -> цель ${TARGET}, кручу ${Math.abs(notches)} щелчков ${need > 0 ? 'вверх' : 'вниз'}`);
  wheel(GAIN_DIAL.x, GAIN_DIAL.y, Math.min(Math.abs(notches), 40), need > 0);
  await sleep(1400);
}

console.log(`\nИТОГ: Gain = ${gain()} (цель ${TARGET})`);
