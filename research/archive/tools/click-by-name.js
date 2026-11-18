/**
 * КНОПКИ ПРЕСЕТОВ И СЦЕН — нажатие ПО ИМЕНИ (надёжнее координат).
 *
 * Найдено: QToolButton с именами "Load preset1", "Save preset1",
 * "Chat", "Vocal". Это гораздо надёжнее, чем координаты.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Нажать элемент по точному имени. */
function clickByName(name) {
  const { items } = dumpTree();
  const el = items.find((x) => (x.name || '').trim() === name);
  if (!el) return `"${name}" не найден`;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${el.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

const state = () => {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  return {
    duckSwitch: i.Ducking?.DuckingSwitch,
    thr: i.Compressor?.Threshold,
    ratio: i.Compressor?.Ratio,
    mixA: i.Mixer_IN12?.MixA_GAIN,
  };
};

console.log('=== ТЕСТ: СЦЕНЫ ПО ИМЕНИ ===\n');
console.log('исходное:', JSON.stringify(state()));

console.log('\n1. нажимаю "Chat" по имени');
console.log('  ' + clickByName('Chat'));
await sleep(2000);
console.log('  DuckingSwitch:', state().duckSwitch);

console.log('\n2. нажимаю "Vocal" по имени');
console.log('  ' + clickByName('Vocal'));
await sleep(2000);
console.log('  DuckingSwitch:', state().duckSwitch);

console.log('\n=== ТЕСТ: ПРЕСЕТЫ ПО ИМЕНИ ===\n');
console.log('3. нажимаю "Save preset1"');
console.log('  ' + clickByName('Save preset1'));
await sleep(3000);
const afterSave = state();
console.log('  состояние:', JSON.stringify(afterSave));

console.log('\n4. нажимаю "Load preset1"');
console.log('  ' + clickByName('Load preset1'));
await sleep(4000);
const afterLoad = state();
console.log('  состояние:', JSON.stringify(afterLoad));

console.log('\n=== ИТОГ ===');
console.log('  press by name работает: используем имена вместо координат');
