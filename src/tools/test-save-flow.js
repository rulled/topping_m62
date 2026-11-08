/**
 * ФИНАЛЬНАЯ ПРОВЕРКА направления: UI -> Save preset -> файл.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree, invoke } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = findActiveWorkspace();
console.log(`workspace: ${ws.name}\n`);

function grab() {
  const ini = readWorkspace(ws.path);
  return {
    in1gain: ini.Input_IN1?.GAIN,
    mixA: ini.Mixer_IN12?.MixA_GAIN,
    in2gain: ini.Input_IN2?.GAIN,
  };
}

console.log('ДО:', JSON.stringify(grab()));

// меняем слайдер
console.log('\nменяю slider[348] -> 3');
ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(348)
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {
  ([System.Windows.Automation.RangeValuePattern]$p).SetValue(3)
}
`);
await sleep(1500);
console.log('после слайдера (без сохранения):', JSON.stringify(grab()));

// нажимаем Save preset1
const { items } = dumpTree();
const save = items.find((x) => (x.name || '').trim() === 'Save preset1');
if (!save) { console.error('Save preset1 не найден'); process.exit(1); }
console.log(`\nнажимаю Save preset1 [${save.i}]`);
console.log('  ' + (await invoke(save.i)));
await sleep(3500);

console.log('\nПОСЛЕ сохранения:', JSON.stringify(grab()));

// проверим, изменился ли файл вообще
const { statSync } = await import('node:fs');
console.log(`\nmtime файла: ${statSync(ws.path).mtime.toISOString()}`);
