/**
 * ДИАПАЗОН МИКРОФОННОГО УСИЛЕНИЯ (Input_INx.GAIN).
 *
 * В файле IN1=20, IN2=26 — больше 12, значит диапазон другой.
 * Проверяем границы перетаскиванием dial'а.
 */
import { ps, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gain = (sec = 'Input_IN1') => Number(readWorkspace(findActiveWorkspace().path)[sec]?.GAIN);

const scale = () => {
  try {
    const raw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1.75;
  } catch { return 1.75; }
};
const S = scale();

function wheel(x, y, n, up = true) {
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const dv = up ? 120 : 0x100000000 - 120;
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSWR {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSWR]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${n}; $i++) {
  [MSWR]::mouse_event(0x0800, 0, 0, ${dv}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
}
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

console.log(`IN1 GAIN сейчас: ${gain()}`);

// dial IN1 = (164,699)
console.log('\n=== кручу ВВЕРХ много раз (ищу максимум) ===');
for (let i = 0; i < 8; i++) {
  const before = gain();
  wheel(164, 699, 10, true);
  await sleep(1200);
  const after = gain();
  if (after === before) {
    console.log(`  упёрлись в максимум: ${after}`);
    break;
  }
  console.log(`  ${before} -> ${after}`);
}

const max = gain();
console.log(`\nМАКСИМУМ IN1 GAIN: ${max}`);

console.log('\n=== кручу ВНИЗ много раз (ищу минимум) ===');
for (let i = 0; i < 20; i++) {
  const before = gain();
  wheel(164, 699, 10, false);
  await sleep(1000);
  const after = gain();
  if (after === before) {
    console.log(`  упёрлись в минимум: ${after}`);
    break;
  }
  if (i % 3 === 0) console.log(`  ${before} -> ${after}`);
}

const min = gain();
console.log(`\nМИНИМУМ IN1 GAIN: ${min}`);

console.log('\n=== ИТОГ ===');
console.log(`  Input_IN1.GAIN диапазон: ${min}..${max}`);

// восстановим 20
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.Input_IN1.GAIN = '20';
writeWorkspace(w.path, ini);
console.log(`  (вернул в файл 20)`);
