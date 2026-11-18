/**
 * Переключить на Pro audio и проверить EQ_HP (10 полос).
 *
 * ВНИМАНИЕ: смена режима ПЕРЕЗАГРУЖАЕТ устройство (1-8 сек).
 */
import { listWorkspaces, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) открыть настройки -> вкладка Device -> Mode select = Pro
console.log('открываю настройки MCC...');
let { items } = dumpTree();
const gear = items.find((x) => x.cls === 'QPushButton' && !x.name && x.w >= 28 && x.w <= 55 && x.h >= 28 && x.h <= 55);
if (!gear) { console.error('шестерёнка не найдена'); process.exit(1); }
await ps(PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(' + gear.i + ')',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
  '}',
].join('\n'));
await sleep(1800);

({ items } = dumpTree());
const tab = items.find((x) => (x.name || '').trim() === 'Device');
if (tab) {
  await ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = Get-MccAll $root',
    '$e = $all.Item(' + tab.i + ')',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '}',
  ].join('\n'));
  await sleep(1500);
}

({ items } = dumpTree());
const modeLbl = items.find((x) => (x.name || '').trim() === 'Mode select');
if (!modeLbl) { console.error('Mode select не найдена'); process.exit(1); }
const combo = items.find((x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - modeLbl.ly) < 30);
console.log(`комбобокс режима: [${combo.i}]`);

// выбрать Pro audio (индекс 2: Mobile=0, Live=1, Pro=2)
console.log('переключаю на Pro audio...');
console.log('  ' + ps(PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(' + combo.i + ')',
  '$e.SetFocus()',
  'Start-Sleep -Milliseconds 250',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()',
  '  Start-Sleep -Milliseconds 500',
  '}',
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
  'Start-Sleep -Milliseconds 150',
  'for ($k=0; $k -lt 2; $k++) {',
  '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
  '  Start-Sleep -Milliseconds 120',
  '}',
  '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  'Write-Output "SENT"',
].join('\n')).trim());

console.log('\nжду перезагрузки устройства...');
await sleep(14000);

// 2) проверить workspace
const all = listWorkspaces();
console.log('\nworkspace после переключения:');
for (const w of all.slice(0, 4)) console.log(`  ${w.mode}/${w.name} (${w.mtime.toISOString()})`);

const prof = all.find((w) => w.mode === 'Prof');
if (prof) {
  const ini = readWorkspace(prof.path);
  const hp = ini.EQ_HP;
  if (hp) {
    console.log(`\n[EQ_HP] в Prof:`);
    console.log(`  Switch = ${hp.Switch}, GainOutput = ${hp.GainOutput}`);
    let n = 0;
    for (let i = 1; i <= 10; i++) {
      const v = hp[`Eq%40${i}`];
      if (v !== undefined) { n++; console.log(`  полоса ${i}: ${v}`); }
    }
    console.log(`  всего полос: ${n}`);
  }
}
