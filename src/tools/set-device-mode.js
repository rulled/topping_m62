/** Вернуть устройство в Live streaming mode. */
import { listWorkspaces, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = process.argv[2] ?? 'Live';
const idx = target === 'Live' ? 1 : target === 'Prof' ? 2 : 0;

let { items } = dumpTree();
const modeLbl = items.find((x) => (x.name || '').trim() === 'Mode select');
if (!modeLbl) {
  // открыть настройки
  const gear = items.find((x) => x.cls === 'QPushButton' && !x.name && x.w >= 28 && x.w <= 55 && x.h >= 28 && x.h <= 55);
  if (gear) {
    await ps(PRELUDE + [
      '$root = Get-MccRoot', '$all = Get-MccAll $root',
      '$e = $all.Item(' + gear.i + ')', '$p = $null',
      'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { ([System.Windows.Automation.InvokePattern]$p).Invoke() }',
    ].join('\n'));
    await sleep(1800);
  }
  ({ items } = dumpTree());
  const tab = items.find((x) => (x.name || '').trim() === 'Device');
  if (tab) {
    await ps(PRELUDE + [
      '$root = Get-MccRoot', '$all = Get-MccAll $root',
      '$e = $all.Item(' + tab.i + ')', '$p = $null',
      'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { ([System.Windows.Automation.InvokePattern]$p).Invoke() }',
    ].join('\n'));
    await sleep(1400);
  }
  ({ items } = dumpTree());
}

const lbl = items.find((x) => (x.name || '').trim() === 'Mode select');
if (!lbl) { console.error('Mode select не найдена — открой настройки вручную'); process.exit(1); }
const combo = items.find((x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - lbl.ly) < 30);
console.log(`переключаю режим на ${target} (индекс ${idx}), combo=[${combo.i}]`);

console.log('  ' + ps(PRELUDE + [
  '$root = Get-MccRoot', '$all = Get-MccAll $root',
  '$e = $all.Item(' + combo.i + ')', '$e.SetFocus()',
  'Start-Sleep -Milliseconds 250', '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()',
  '  Start-Sleep -Milliseconds 500',
  '}',
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
  'Start-Sleep -Milliseconds 150',
  'for ($k=0; $k -lt ' + idx + '; $k++) { [System.Windows.Forms.SendKeys]::SendWait("{DOWN}"); Start-Sleep -Milliseconds 120 }',
  '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  'Write-Output "SENT"',
].join('\n')).trim());

console.log('жду перезагрузку...');
await sleep(14000);

const all = listWorkspaces();
console.log('\nактивный workspace:', all[0].mode + '/' + all[0].name);
const ini = readWorkspace(all[0].path);
console.log('  Input_IN1.GAIN =', ini.Input_IN1?.GAIN);
console.log('  EQ_IN1.Switch =', ini.EQ_IN1?.Switch);
