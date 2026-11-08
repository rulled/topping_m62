/**
 * НАЙДЕНА КНОПКА EQ рядом с IN1!
 *
 * На скриншоте input-area.png (смещение 771,52, scale=1):
 *   IN1: 48V (157,162), AUTO (157,190), EQ (157,218), DUCKING (157,246)
 *   Координаты логические = 771 + x, 52 + y
 *
 * Проверяем: нажатие должно включить EQ_IN1.Switch.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// координаты на скриншоте -> логические
const OFF_X = 771;
const OFF_Y = 52;
const BTN_IN1 = { x: OFF_X + 157, y: OFF_Y + 218, label: 'EQ IN1' };
const BTN_IN2 = { x: OFF_X + 306, y: OFF_Y + 218, label: 'EQ IN2' };

console.log('целевые координаты:');
console.log(`  ${BTN_IN1.label}: (${BTN_IN1.x},${BTN_IN1.y})`);
console.log(`  ${BTN_IN2.label}: (${BTN_IN2.x},${BTN_IN2.y})`);

// ищем кнопку в этой точке
const { items } = dumpTree();
function findNearest(lx, ly, maxDist = 25) {
  let best = null;
  let bestD = Infinity;
  for (const e of items) {
    if (!/QPushButton|QToolButton/.test(e.cls ?? '')) continue;
    const d = Math.abs(e.lx - lx) + Math.abs(e.ly - ly);
    if (d < bestD) { bestD = d; best = e; }
  }
  return bestD <= maxDist ? { el: best, dist: bestD } : null;
}

const hit1 = findNearest(BTN_IN1.x, BTN_IN1.y);
const hit2 = findNearest(BTN_IN2.x, BTN_IN2.y);
console.log('\nнайденные кнопки:');
console.log('  IN1 EQ:', hit1 ? `[${hit1.el.i}] ${hit1.el.cls} (${hit1.el.lx},${hit1.el.ly}) dist=${hit1.dist}` : 'не найдена');
console.log('  IN2 EQ:', hit2 ? `[${hit2.el.i}] ${hit2.el.cls} (${hit2.el.lx},${hit2.el.ly}) dist=${hit2.dist}` : 'не найдена');

if (!hit1) { console.log('\nкнопка не найдена — прерываю'); process.exit(1); }

const sw = () => {
  const i = readWorkspace(findActiveWorkspace().path);
  return { in1: i.EQ_IN1?.Switch, in2: i.EQ_IN2?.Switch };
};

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
  return ps(RAW).trim();
}

console.log('\n=== ДО ===');
console.log(' ', JSON.stringify(sw()));

console.log(`\n=== нажимаю [${hit1.el.i}] (EQ IN1) ===`);
console.log('  ' + click(hit1.el.i));
await sleep(2500);
console.log('  после:', JSON.stringify(sw()));

const after = sw();
if (after.in1 === '1') {
  console.log('\n*** ЭТО КНОПКА EQ! Switch стал 1 ***');
  console.log('  (оставляю включённым для проверки окна настроек)');
} else {
  console.log('\n  не включилось — возможно, файл не обновляется без перезапуска MCC');
  console.log('  проверю через HID...');
}
