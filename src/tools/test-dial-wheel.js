/**
 * Пробуем РАЗНЫЕ способы взаимодействия с dial'ом Ratio:
 *   1) обычный drag
 *   2) колесо мыши над dial
 *   3) клик + стрелки клавиатуры
 *   4) двойной клик + ввод
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ratio = () => {
  const ws = findActiveWorkspace();
  return Number(readWorkspace(ws.path).Compressor?.Ratio);
};

const scale = () => {
  try { return Number(ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.')) || 1.75; } catch { return 1.75; }
};
const S = scale();

// координаты dial'а Ratio — пробуем соседние, т.к. не уверены
const CANDIDATES = [
  { x: 958, y: 1384, label: 'предполагаемый Ratio' },
  { x: 1020, y: 1262, label: 'предполагаемый Attack' },
  { x: 1086, y: 1384, label: 'предполагаемый Release' },
];

function scroll(x, y, delta) {
  const dval = delta < 0 ? (0x100000000 + delta) : delta;
  const px = Math.round(x / S);
  const py = Math.round(y / S);
  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSW {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSW]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
[MSW]::mouse_event(0x0800, 0, 0, ${delta}, [IntPtr]::Zero)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' });
}

console.log(`текущий Ratio = ${ratio()}\n`);

for (const c of CANDIDATES) {
  const before = ratio();
  console.log(`--- ${c.label} (${c.x},${c.y}) ---`);

  // 1) колесо вверх
  scroll(c.x, c.y, 120);
  await sleep(1200);
  let after = ratio();
  console.log(`  колесо вверх: ${before} -> ${after}${after !== before ? '  <<< РАБОТАЕТ' : ''}`);
  if (after !== before) { scroll(c.x, c.y, -120); await sleep(900); continue; }

  // 2) колесо вниз
  scroll(c.x, c.y, -120);
  await sleep(1200);
  after = ratio();
  console.log(`  колесо вниз:  ${before} -> ${after}${after !== before ? '  <<< РАБОТАЕТ' : ''}`);
  if (after !== before) { scroll(c.x, c.y, 120); await sleep(900); continue; }

  console.log('  колесо не действует');
}

console.log(`\nитоговый Ratio = ${ratio()}`);
