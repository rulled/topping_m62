/**
 * EQ IN PRO-РЕЖИМЕ: есть ли кнопка включения?
 *
 * В Live EQ-контролов нет. Проверяем Pro.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps2 = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const cnt = Number(ps2('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'));
console.log(`MCC запущен: ${cnt > 0}`);

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`workspace: ${ws.mode}/${ws.name}`);
console.log(`EQ_HP есть: ${Boolean(ini.EQ_HP)}`);
if (ini.EQ_HP) {
  console.log(`  EQ_HP.Switch: ${ini.EQ_HP.Switch}`);
  console.log(`  EQ_HP.GainOutput: ${ini.EQ_HP.GainOutput}`);
  for (const [k, v] of Object.entries(ini.EQ_HP)) {
    if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
  }
}

console.log('\n=== ИЩУ EQ-КОНТРОЛЫ В UI (Pro) ===');
const { items } = dumpTree();
console.log(`элементов: ${items.length}`);

// все подписи
console.log('\nвсе подписи:');
for (const l of items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim())) {
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.slice(0, 30)}"`);
}

// слайдеры с диапазонами
console.log('\nслайдеры:');
const sliders = items.filter((x) => x.cls === 'QSlider').sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const s of sliders) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${s.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NP" }',
  ].join('\n');
  const r = ps(RAW).trim();
  console.log(`  [${String(s.i).padStart(3)}] (${String(s.lx).padStart(4)},${String(s.ly).padStart(4)}) ${r}`);
}

// кнопки
console.log('\nкнопки (первые 25):');
const btns = items.filter((x) => x.cls === 'QPushButton' || x.cls === 'QToolButton').sort((a, b) => a.ly - b.ly || a.lx - b.lx);
for (const b of btns.slice(0, 25)) {
  console.log(`  [${String(b.i).padStart(3)}] ${b.cls.padEnd(12)} (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)}) "${(b.name || '').slice(0, 22)}"`);
}
