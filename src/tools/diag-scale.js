/**
 * Сравнение PRELUDE из uia.js и из ui-control.js.
 */
import { ps as uiaPs, PRELUDE as UIA_PRELUDE } from './uia.js';

console.log('=== uia.js PRELUDE ===');
try {
  const v = uiaPs(UIA_PRELUDE + 'Write-Output $script:scale');
  console.log('  scale =', JSON.stringify(v));
} catch (e) {
  console.log('  ошибка:', e.message.slice(0, 100));
}

console.log('\n=== ui-control.js PRELUDE ===');
// импортируем сам модуль и смотрим его scale через dragDial-подобный вызов
const mod = await import('../ui-control.js');
console.log('  экспорты:', Object.keys(mod).join(', '));

// напрямую проверим PRELUDE через свой скрипт
const PRELUDE_OWN = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DDX {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
}
'@
[DDX]::SetProcessDPIAware() | Out-Null
$dc = [DDX]::GetDC([IntPtr]::Zero)
$script:scale = [DDX]::GetDeviceCaps($dc, 88) / 96.0
[DDX]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null
`;
try {
  const v = uiaPs(PRELUDE_OWN + 'Write-Output $script:scale');
  console.log('  scale =', JSON.stringify(v));
} catch (e) {
  console.log('  ошибка:', e.message.slice(0, 100));
}

console.log('\n=== проблема ===');
console.log('Если тут NaN — значит ui-control.js использует другой PRELUDE.');
console.log('Проверим исходник ui-control.js на наличие GetDeviceCaps:');
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../ui-control.js', import.meta.url), 'utf8');
const m = src.match(/\$script:scale[^\n]*/);
console.log('  строка:', m ? m[0].trim() : 'не найдена');
const dc = src.match(/GetDeviceCaps\([^)]*\)[^\n]*/g);
console.log('  GetDeviceCaps вызовы:', dc ? dc.map((x) => x.trim()).join(' | ') : 'нет');
