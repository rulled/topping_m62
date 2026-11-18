/**
 * ПРОВЕРКА: какая кнопка в области Input включает EQ?
 *
 * Колонка IN1: [165]y=140, [166]y=162, [167]y=186, [158]y=210, [160]y=240, [161]y=270, [159]y=300
 * На скриншоте: 48V, AUTO, EQ, DUCKING. Пробуем каждую и смотрим EQ_IN1.Switch.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sw = () => readWorkspace(findActiveWorkspace().path).EQ_IN1?.Switch;

function click(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

console.log(`=== EQ_IN1.Switch сейчас: ${sw()} ===\n`);

const CANDIDATES = [165, 166, 167, 158, 160, 161, 159];

for (const idx of CANDIDATES) {
  const { items } = dumpTree();
  const el = items.find((x) => String(x.i) === String(idx));
  if (!el) { console.log(`[${idx}] не найден (индексы сдвинулись)`); continue; }

  const before = sw();
  const r = click(idx);
  await sleep(2200);
  const after = sw();

  const changed = String(before) !== String(after);
  console.log(`[${String(idx).padStart(3)}] (${el.lx},${el.ly}) ${r.padEnd(5)} EQ: ${before} -> ${after}  ${changed ? '*** ЭТО EQ! ***' : ''}`);

  if (changed) {
    // вернуть обратно
    click(idx);
    await sleep(1500);
    console.log(`  вернул: ${sw()}`);
    console.log(`\n  КНОПКА EQ ДЛЯ IN1: [${idx}] (${el.lx},${el.ly})`);
    break;
  }
}

console.log(`\nитог EQ_IN1.Switch: ${sw()}`);
