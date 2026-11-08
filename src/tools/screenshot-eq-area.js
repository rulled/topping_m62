/**
 * ВИЗУАЛЬНЫЙ ПОИСК: делаем скриншот области IN1/IN2.
 *
 * Пользователь говорит: "кнопка EQ рядом с IN1/IN2".
 * Нужно увидеть глазами, где она.
 */
import { execFileSync } from 'node:child_process';
import { ps, PRELUDE, dumpTree } from './uia.js';

const { items } = dumpTree();

// находим IN1
const in1 = items.find((x) => (x.name || '').trim() === 'IN1');
const in2 = items.find((x) => (x.name || '').trim() === 'IN2');
console.log('IN1:', in1 ? `(${in1.lx},${in1.ly})` : 'не найден');
console.log('IN2:', in2 ? `(${in2.lx},${in2.ly})` : 'не найден');

if (!in1) process.exit(1);

// масштаб
const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
const scale = Number(scaleRaw) || 1.75;
console.log(`DPI scale: ${scale}`);

// область для скриншота (физические пиксели): вокруг IN1/IN2
const lx = Math.round((in1.lx - 120) / scale);
const ly = Math.round((in1.ly - 120) / scale);
const w = Math.round(520 / scale);
const h = Math.round(420 / scale);

console.log(`область скриншота (физ): x=${lx} y=${ly} w=${w} h=${h}`);

const SCRIPT = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${lx}, ${ly}, 0, 0, $bmp.Size)
$out = 'E:\Programming shit\Topping\research\eq-area.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved"
`;
try {
  console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', SCRIPT], { encoding: 'utf8' }).trim());
} catch (e) {
  console.log('ошибка скриншота:', e.message.slice(0, 120));
}
