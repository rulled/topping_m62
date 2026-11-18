/**
 * Проверка расхождения с мануалом: отключает ли Chat реверб,
 * если реверб ВКЛЮЧЁН?
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fx() {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    reverbType: i.Effect_Integration?.ReverbType,
    muteFX: i.Effect_Integration?.MuteFX,
    duckSwitch: i.Ducking?.DuckingSwitch,
  };
}

function clickScene(name) {
  const { items } = dumpTree();
  const btn = items.find((x) => (x.name || '').trim() === name);
  if (!btn) return `не найдена`;
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
    '$e = $all.Item(' + btn.i + ')', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// Шаг 1: включить реверб через файл (Studio)
const ws = findActiveWorkspace();
let ini = readWorkspace(ws.path);
console.log('до правки ReverbType =', ini.Effect_Integration?.ReverbType);
ini.Effect_Integration.ReverbType = 'Studio';
writeWorkspace(ws.path, ini);
console.log('записал ReverbType = Studio в файл');

// перезапустить MCC чтобы применилось
console.log('перезапускаю MCC...');
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue'], { encoding: 'utf8' });
await sleep(4000);
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'], { encoding: 'utf8' });
await sleep(13000);

console.log('\nпосле перезапуска:', JSON.stringify(fx()));

// Шаг 2: нажать Chat
console.log('\nнажимаю Chat...');
console.log('  ' + clickScene('Chat'));
await sleep(3000);

const after = fx();
console.log('\nпосле Chat:', JSON.stringify(after));

if (after.reverbType === fx().reverbType) {
  console.log('\nReverbType не изменился — сцена его не трогает');
} else {
  console.log('\nReverbType изменился — сцена его меняет');
}
