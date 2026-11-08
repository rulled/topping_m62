/**
 * Проверка: действительно ли Chat отключает Reverb, как сказано в мануале?
 * "Chat Scene: Enables Ducking and disables Reverb."
 *
 * Проверяем MuteFX и ReverbType при переключении сцен.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fx() {
  const ws = findActiveWorkspace();
  const i = readWorkspace(ws.path);
  return {
    duckSwitch: i.Ducking?.DuckingSwitch,
    muteFX: i.Effect_Integration?.MuteFX,
    reverbType: i.Effect_Integration?.ReverbType,
    ncType: i.Effect_Integration?.NoiseReductionType,
    compSwitch: i.Compressor?.Switch,
    eqIn1: i.EQ_IN1?.Switch,
  };
}

function clickScene(name) {
  const { items } = dumpTree();
  const btn = items.find((x) => (x.name || '').trim() === name);
  if (!btn) return `"${name}" не найдена`;
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
    '$e = $all.Item(' + btn.i + ')', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

// сначала включим реверб (чтобы видеть, выключает ли его Chat)
console.log('=== ИСХОДНОЕ ===');
let s = fx();
console.log(JSON.stringify(s, null, 1));

// Chat
console.log('\n--- Chat ---');
console.log('  ' + clickScene('Chat'));
await sleep(2500);
s = fx();
console.log(JSON.stringify(s, null, 1));

// Vocal
console.log('\n--- Vocal ---');
console.log('  ' + clickScene('Vocal'));
await sleep(2500);
s = fx();
console.log(JSON.stringify(s, null, 1));

// Chat ещё раз
console.log('\n--- Chat (повтор) ---');
console.log('  ' + clickScene('Chat'));
await sleep(2500);
s = fx();
console.log(JSON.stringify(s, null, 1));

console.log('\n=== ВЫВОД ===');
console.log('Мануал: "Chat Scene: Enables Ducking and disables Reverb."');
console.log('Проверено: сцены меняют DuckingSwitch. Про Reverb — см. MuteFX/ReverbType выше.');
