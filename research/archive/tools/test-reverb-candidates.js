/**
 * ПРОВЕРКА: [323],[324],[325],[326] — это кнопки типа реверба?
 *
 * Они на x=577, y=834/866/897/928 — под подписью Decay (540,753).
 * Мы в Bypass, поэтому проверяем: нажатие должно сменить ReverbType.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reverb = () => readWorkspace(findActiveWorkspace().path).Effect_Integration?.ReverbType;

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

console.log(`реверб сейчас: ${reverb()}\n`);

const CANDIDATES = [323, 324, 325, 326];

for (const idx of CANDIDATES) {
  const { items } = dumpTree();
  const el = items.find((x) => String(x.i) === String(idx));
  if (!el) { console.log(`[${idx}] не найден`); continue; }

  const before = reverb();
  const r = click(idx);
  await sleep(2500);
  const after = reverb();

  console.log(`[${String(idx).padStart(3)}] (${el.lx},${el.ly}) ${r.padEnd(8)} ${before} -> ${after}  ${before !== after ? '<<< ЭТО РЕВЕРБ' : ''}`);
}

console.log(`\nитог: ${reverb()}`);
