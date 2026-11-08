/**
 * Переключить workspace в MCC и проверить, применились ли правки файла.
 */
import { listWorkspaces, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = process.argv[2] ?? 'main';
console.log(`переключаю workspace на "${target}"\n`);

const PS_LIST = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(8)',
  '$e.SetFocus()',
  'Start-Sleep -Milliseconds 250',
  '$p = $null',
  'if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) {',
  '  ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()',
  '  Start-Sleep -Milliseconds 600',
  '}',
  '$names = @()',
  '$all2 = Get-MccAll $root',
  'for ($j=0; $j -lt $all2.Count; $j++) {',
  '  $q = $all2.Item($j)',
  '  if ($q.Current.ClassName -ne "QListWidget") { continue }',
  '  $kids = $q.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
  '  if ($kids.Count -gt 0) {',
  '    for ($k=0; $k -lt $kids.Count; $k++) {',
  '      $nm = $kids.Item($k).Current.Name',
  '      if ($nm) { $names += ($nm.Trim()) }',
  '    }',
  '    break',
  '  }',
  '}',
  '([System.Windows.Automation.ExpandCollapsePattern]$p).Collapse()',
  'Write-Output ($names -join "~")',
].join('\n');

const opts = ps(PS_LIST).trim();
const options = opts.split('~').filter(Boolean);
console.log('варианты workspace в UI:');
options.forEach((o, i) => console.log(`  ${i}: "${o}"`));

const idx = options.indexOf(target);
if (idx < 0) {
  console.log(`\n"${target}" в списке нет`);
  process.exit(0);
}
console.log(`\n"${target}" = индекс ${idx}, выбираю`);

const PS_PICK = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$e = $all.Item(8)',
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
  `for ($k=0; $k -lt ${idx}; $k++) {`,
  '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
  '  Start-Sleep -Milliseconds 120',
  '}',
  '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
  'Start-Sleep -Milliseconds 800',
  'Write-Output "PICKED"',
].join('\n');

console.log('  ' + ps(PS_PICK).trim());
await sleep(4000);

// проверить main.ini и текущее состояние
const after = listWorkspaces();
console.log('\nworkspace после переключения:');
for (const w of after) {
  console.log(`  ${w.mode}/${w.name.padEnd(20)} ${w.mtime.toISOString()}`);
}

const main = after.find((w) => w.name === 'main');
if (main) {
  const ini = readWorkspace(main.path);
  console.log(`\nmain.ini сейчас: MixA_GAIN=${ini.Mixer_IN12?.MixA_GAIN}, GAIN=${ini.Input_IN1?.GAIN}`);
}
