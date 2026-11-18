/** Изучаем FieldEffectS1M1 [341]: его Value и что он делает при Invoke. */
import { ps, PRELUDE } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const comp = () => {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return { thr: i.Compressor?.Threshold, ratio: i.Compressor?.Ratio, att: i.Compressor?.Attack };
};

console.log('ДО:', JSON.stringify(comp()));

// читаем Value у FieldEffectS1M1
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(341)',
  '$p = $null',
  '$v = "нет Value"',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
  '  $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value',
  '  $ro = ([System.Windows.Automation.ValuePattern]$p).Current.IsReadOnly',
  '  Write-Output ("VALUE=[" + $v + "] READONLY=" + $ro)',
  '} else { Write-Output "NOVALUE" }',
  'Write-Output ("NAME=" + $e.Current.Name + " CLS=" + $e.Current.ClassName)',
  'Write-Output ("HELP=" + $e.Current.HelpText)',
].join('\n');
console.log(ps(RAW));

// смотрим также Chart [374]
const RAW2 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(374)',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
  '  Write-Output ("CHART VALUE=[" + ([System.Windows.Automation.ValuePattern]$p).Current.Value + "]")',
  '} else { Write-Output "CHART NOVALUE" }',
].join('\n');
console.log(ps(RAW2));

// пробуем двойной клик по Chart -> может открыть диалог
console.log('\nдвойной клик по Chart [374]...');
const px = Math.round(756 / 1.75);
const py = Math.round(1114 / 1.75);
const { execFileSync } = await import('node:child_process');
const DBL = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MS6 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MS6]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MS6]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MS6]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 120
[MS6]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MS6]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "dbl"
`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', DBL], { encoding: 'utf8' });
await sleep(2000);

// что изменилось в дереве
const RAW3 = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  'Write-Output ("COUNT=" + $all.Count)',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = $e.Current.ClassName',
  '  if ($cls -match "Dialog|Popup|Menu|ListWidget") {',
  '    $r = $e.Current.BoundingRectangle',
  '    $res += [pscustomobject]@{ i=$i; cls=$cls; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2) }',
  '  }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const out3 = ps(RAW3);
console.log(out3.split('\n')[0]);
try {
  const arr = JSON.parse(out3.split('\n').slice(1).join('\n'));
  const list = Array.isArray(arr) ? arr : [arr];
  console.log(`диалоги/меню: ${list.length}`);
  for (const e of list) console.log(`  [${e.i}] ${e.cls} (${e.x},${e.y})`);
} catch { console.log('  (нет новых элементов)'); }

console.log('\nПОСЛЕ:', JSON.stringify(comp()));
