/**
 * РЕШАЮЩИЙ ТЕСТ: применяется ли правка файла БЕЗ перезапуска MCC?
 *
 * Смотрим на UI: если слайдер обновился — применилось.
 * Если нет — MCC держит состояние в памяти и файл лишь хранилище.
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const w = findActiveWorkspace();
const mixA = () => readWorkspace(findActiveWorkspace().path).Mixer_IN12?.MixA_GAIN;

/** Прочитать значение слайдера Mix A из UI. */
function uiMixA() {
  const { items } = dumpTree();
  const sliders = items.filter((x) => x.cls === 'QSlider' && x.ly > 450 && x.ly < 620 && x.lx > 1100)
    .sort((a, b) => a.lx - b.lx);
  if (!sliders.length) return null;
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${sliders[0].i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.RangeValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const out = ps(RAW).trim();
  return out === 'NOPATTERN' ? null : Number(out);
}

console.log('=== 1. исходное ===');
const fileBefore = mixA();
const uiBefore = uiMixA();
console.log(`  файл: ${fileBefore}`);
console.log(`  UI:   ${uiBefore}`);

console.log('\n=== 2. меняю ТОЛЬКО файл (при работающем MCC) ===');
const NEW = fileBefore === '11' ? '2' : '11';
const ini = readWorkspace(w.path);
ini.Mixer_IN12.MixA_GAIN = NEW;
writeWorkspace(w.path, ini);
console.log(`  записал ${NEW}`);

console.log('\n=== 3. жду 6 с и смотрю UI ===');
await sleep(6000);
const uiAfter = uiMixA();
console.log(`  файл: ${mixA()}`);
console.log(`  UI:   ${uiAfter}`);

console.log('\n=== 4. ВЫВОД ===');
if (uiAfter === Number(NEW)) {
  console.log('  *** UI ОБНОВИЛСЯ — правка файла применяется БЕЗ перезапуска! ***');
  console.log('  Значит 17-секундный цикл НЕ НУЖЕН для этого параметра.');
} else if (uiAfter === uiBefore) {
  console.log('  UI НЕ изменился — MCC держит состояние в памяти.');
  console.log('  Файл — только хранилище, применяется при перезапуске.');
} else {
  console.log(`  UI показал ${uiAfter} — что-то другое`);
}

// вернуть исходное
const restore = readWorkspace(w.path);
restore.Mixer_IN12.MixA_GAIN = fileBefore;
writeWorkspace(w.path, restore);
console.log(`\n(вернул ${fileBefore})`);
