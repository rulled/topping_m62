/**
 * Что именно сохраняет пресет? Сравниваем полное состояние до и после.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function full() {
  const ws = findActiveWorkspace();
  return readWorkspace(ws.path);
}

function clickTool(label) {
  const { items } = dumpTree();
  const btn = items.find((x) => (x.name || '').trim() === label);
  if (!btn) return `не найдена`;
  return ps(PRELUDE + [
    '$root = Get-MccRoot', '$all = Get-MccAll $root',
    '$e = $all.Item(' + btn.i + ')', '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke(); Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

function diff(a, b) {
  const out = [];
  for (const sec of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = a[sec] ?? {}, sb = b[sec] ?? {};
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (String(sa[k]) !== String(sb[k])) out.push(`${sec}.${k}: ${sa[k]} -> ${sb[k]}`);
    }
  }
  return out;
}

const A = full();
console.log(`исходное состояние: ${Object.keys(A).length} секций`);

// сохраняем
console.log('\nSave preset2...');
console.log('  ' + clickTool('Save preset2'));
await sleep(3000);

// меняем НЕСКОЛЬКО разных блоков
const PORT = process.env.M62_PORT ?? '8842';
const changes = [
  { section: 'Input_IN1', key: 'GAIN', value: 12 },
  { section: 'Mixer_IN12', key: 'MixA_GAIN', value: 2 },
  { section: 'Loopback_LB12', key: 'GAIN', value: -30 },
  { section: 'Output_HP', key: 'GAIN', value: -40 },
  { section: 'Ducking', key: 'Threshold', value: -10 },
  { section: 'EQ_IN1', key: 'Eq%401', value: '|0|632|0.7|8' },
];
console.log('\nменяю 6 параметров в 6 разных блоках...');
await fetch(`http://127.0.0.1:${PORT}/api/workspace/apply`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ changes }),
});
await sleep(2000);

const B = full();
const d1 = diff(A, B);
console.log(`\nизменения после правки: ${d1.length}`);
for (const l of d1) console.log(`  ${l}`);

// загружаем пресет
console.log('\nLoad preset2...');
console.log('  ' + clickTool('Load preset2'));
await sleep(4500);

const C = full();
console.log('\n=== что ВОССТАНОВИЛ пресет ===');
const d2 = diff(B, C);
if (!d2.length) console.log('  ничего');
for (const l of d2) console.log(`  ${l}`);

console.log('\n=== что НЕ восстановилось (осталось изменённым) ===');
const notRestored = [];
for (const c of changes) {
  const before = A[c.section]?.[c.key];
  const now = C[c.section]?.[c.key];
  const ok = String(before) === String(now);
  console.log(`  ${c.section}.${c.key}: было "${before}", сейчас "${now}"  ${ok ? 'ВОССТАНОВЛЕНО' : 'НЕ восстановлено'}`);
  if (!ok) notRestored.push(`${c.section}.${c.key}`);
}
console.log(`\nне восстановлено: ${notRestored.length} из ${changes.length}`);
