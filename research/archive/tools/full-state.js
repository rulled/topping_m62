/**
 * ПОЛНАЯ ДИАГНОСТИКА СОСТОЯНИЯ — что реально включено/выключено.
 *
 * Читает TogglePattern у всех переключателей (это истина, файл врёт).
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

function describe(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$o = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $o += "T=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $o += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $rv=[System.Windows.Automation.RangeValuePattern]$p; $o += "R=" + $rv.Current.Value }',
    'if ($o.Count -eq 0) { Write-Output "" } else { Write-Output ($o -join " ") }',
  ].join('\n');
  try { return ps(RAW).trim(); } catch { return 'ERR'; }
}

const { items } = dumpTree();
console.log(`элементов: ${items.length}`);
console.log(`окно EQ: ${items.some((x) => /EqualizerPanel/.test(x.cls ?? '')) ? 'ОТКРЫТО' : 'закрыто'}\n`);

// ── колонка IN1: 48V, AUTO, ..., EQ, DUCKING ──
console.log('═══ КОЛОНКА IN1 (Input) ═══');
const colIN1 = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 100 && x.lx < 150 && x.ly > 100 && x.ly < 350)
  .sort((a, b) => a.ly - b.ly);
const NAMES_IN1 = ['48V', 'AUTO', '?3', '?4', '?5', 'EQ', 'DUCKING'];
colIN1.forEach((b, i) => {
  console.log(`  ${String(i).padStart(2)} [${String(b.i).padStart(3)}] (${b.lx},${b.ly}) ${describe(b.i).padEnd(10)} ${NAMES_IN1[i] ?? ''}`);
});

// ── колонка IN2 ──
console.log('\n═══ КОЛОНКА IN2 ═══');
const colIN2 = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 260 && x.lx < 300 && x.ly > 100 && x.ly < 350)
  .sort((a, b) => a.ly - b.ly);
colIN2.forEach((b, i) => {
  console.log(`  ${String(i).padStart(2)} [${String(b.i).padStart(3)}] (${b.lx},${b.ly}) ${describe(b.i).padEnd(10)} ${NAMES_IN1[i] ?? ''}`);
});

// ── выходы и MUTE ──
console.log('\n═══ ВЫХОДЫ / MUTE ═══');
const outs = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.lx > 1250 && x.ly > 850 && x.ly < 1000)
  .sort((a, b) => a.lx - b.lx || a.ly - b.ly);
for (const o of outs) {
  console.log(`  [${String(o.i).padStart(3)}] (${String(o.lx).padStart(4)},${String(o.ly).padStart(4)}) ${describe(o.i)}`);
}

// ── EQ-полосы в окне (если открыто) ──
const panel = items.find((x) => /EqualizerPanel/.test(x.cls ?? ''));
if (panel) {
  console.log('\n═══ ОКНО EQ: ТИПЫ ФИЛЬТРОВ ═══');
  const combos = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx);
  combos.forEach((c, i) => console.log(`  полоса ${i + 1}: [${c.i}] (${c.lx},${c.ly}) ${describe(c.i)}`));
}

// ── файл ──
console.log('\n═══ ФАЙЛ ═══');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
console.log(`  workspace: ${w.mode}/${w.name}`);
for (const sec of ['EQ_IN1', 'EQ_IN2', 'EQ_HP']) {
  if (!ini[sec]) continue;
  console.log(`  [${sec}] Switch=${ini[sec].Switch}`);
  for (const k of ['Eq%401', 'Eq%402', 'Eq%403', 'Eq%404']) {
    if (ini[sec][k]) console.log(`    ${k} = ${ini[sec][k]}`);
  }
}
console.log(`  Output_HP: GAIN=${ini.Output_HP?.GAIN} MUTE=${ini.Output_HP?.MUTE}`);
console.log(`  Output_OTGOUT: GAIN=${ini.Output_OTGOUT?.GAIN} MUTE=${ini.Output_OTGOUT?.MUTE}`);
console.log(`  Input_IN1: GAIN=${ini.Input_IN1?.GAIN} MUTE=${ini.Input_IN1?.MUTE}`);
console.log(`  Input_IN2: GAIN=${ini.Input_IN2?.GAIN} MUTE=${ini.Input_IN2?.MUTE}`);
