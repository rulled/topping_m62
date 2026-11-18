/**
 * ПРОВЕРКА: работает ли InvokePattern на диале как шаг?
 *
 * У DialS1M5 есть INVOKE. Пробуем Invoke() и смотрим, меняется ли файл.
 * Безопасно: EQ выключен, MUTE включён.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const band = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.['Eq%401'];

function invoke(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output "INVOKED"',
    '} else { Write-Output "NO_INVOKE" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch (e) { return 'ERR: ' + e.message.slice(0, 80); }
}

const { items } = dumpTree();
const hasEq = items.some((x) => /EqualizerPanel/.test(x.cls ?? ''));
if (!hasEq) { console.log('окно EQ закрыто'); process.exit(1); }

console.log(`Eq%401 до: ${band()}\n`);

// Gain dial полосы 1: (714,564)
const gainDial = items.find((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - 714) < 20 && Math.abs(x.ly - 564) < 20);
console.log(`Gain dial: ${gainDial ? `[${gainDial.i}] (${gainDial.lx},${gainDial.ly})` : 'не найден'}`);
if (!gainDial) process.exit(1);

console.log('\n=== Invoke() на диале Gain ===');
for (let i = 0; i < 3; i++) {
  const { items: it } = dumpTree();
  const d = it.find((x) => /Dial/.test(x.cls ?? '') && Math.abs(x.lx - 714) < 20 && Math.abs(x.ly - 564) < 20);
  if (!d) { console.log('  диал пропал'); break; }
  const r = invoke(d.i);
  await sleep(1200);
  console.log(`  попытка ${i + 1}: ${r}, файл: ${band()}`);
}

console.log(`\nEq%401 после: ${band()}`);
