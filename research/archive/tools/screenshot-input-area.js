/**
 * Скриншот области INPUT (входы микрофона), где должна быть кнопка EQ.
 *
 * Заголовок "Input" на (858,98). Область входов: y 98..520.
 */
import { execFileSync } from 'node:child_process';
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();
const inputLabel = items.find((x) => (x.name || '').trim() === 'Input');
console.log('Input label:', inputLabel ? `(${inputLabel.lx},${inputLabel.ly})` : 'не найден');

const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;
console.log(`scale: ${scale}`);

// область: от Input label вниз и вширь
const baseX = inputLabel ? inputLabel.lx : 850;
const baseY = inputLabel ? inputLabel.ly : 98;
const lx = Math.round((baseX - 80) / scale);
const ly = Math.round((baseY - 30) / scale);
const w = Math.round(700 / scale);
const h = Math.round(480 / scale);

console.log(`область: x=${lx} y=${ly} w=${w} h=${h}`);

const SCRIPT = String.raw`
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${lx}, ${ly}, 0, 0, $bmp.Size)
$out = 'E:\Programming shit\Topping\research\input-area.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved"
`;
try {
  console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' }).trim());
} catch (e) {
  console.log('ошибка:', e.message.slice(0, 100));
}

// выводим все элементы в области Input для ориентира
console.log('\n=== элементы области Input (x 700..1600, y 60..560) ===');
const area = items.filter((x) => x.lx > 700 && x.lx < 1600 && x.ly > 60 && x.ly < 560)
  .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const e of area) {
  const nm = (e.name || '').replace(/\n/g, '/').slice(0, 22);
  console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(18)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) "${nm}"`);
}
