/**
 * ПРЕСЕТЫ: проверяем полный цикл Save -> изменить -> Load -> восстановилось?
 *
 * Использует кнопки UI: Save preset1 / Load preset1.
 * Проверяет по файлу, что состояние вернулось.
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snap() {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return {
    in1gain: ini.Input_IN1?.GAIN,
    mixA: ini.Mixer_IN12?.MixA_GAIN,
    lb12gain: ini.Loopback_LB12?.GAIN,
    hpGain: ini.Output_HP?.GAIN,
    duckThr: ini.Ducking?.Threshold,
  };
}

function clickTool(label) {
  const { items } = dumpTree();
  const btn = items.find((x) => (x.name || '').trim() === label);
  if (!btn) return `"${label}" не найдена`;
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = Get-MccAll $root',
    '$e = $all.Item(' + btn.i + ')',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n')).trim();
}

console.log('=== ИСХОДНОЕ ===');
const s0 = snap();
console.log(JSON.stringify(s0, null, 1));

// 1) сохранить в preset1
console.log('\n1) Save preset1');
console.log('   ' + clickTool('Save preset1'));
await sleep(3000);

// 2) изменить состояние (через файл)
console.log('\n2) меняю состояние (GAIN=7, MixA=3)');
const PORT = process.env.M62_PORT ?? '8841';
const r = await fetch(`http://127.0.0.1:${PORT}/api/workspace/apply`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    changes: [
      { section: 'Input_IN1', key: 'GAIN', value: 7 },
      { section: 'Mixer_IN12', key: 'MixA_GAIN', value: 3 },
    ],
  }),
});
console.log(`   applied, restarted`);
await sleep(2000);
const s1 = snap();
console.log('   стало:', JSON.stringify(s1));

// 3) загрузить preset1
console.log('\n3) Load preset1');
console.log('   ' + clickTool('Load preset1'));
await sleep(4000);

const s2 = snap();
console.log('\n=== ПОСЛЕ ЗАГРУЗКИ ПРЕСЕТА ===');
console.log(JSON.stringify(s2, null, 1));

const restored = s2.in1gain === s0.in1gain && s2.mixA === s0.mixA;
console.log(`\nвосстановилось ли исходное: ${restored ? 'ДА' : 'НЕТ'}`);
if (!restored) {
  console.log(`  было: GAIN=${s0.in1gain} MixA=${s0.mixA}`);
  console.log(`  стало: GAIN=${s2.in1gain} MixA=${s2.mixA}`);
}
