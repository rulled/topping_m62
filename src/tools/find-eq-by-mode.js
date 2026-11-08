/**
 * EQ-КОНТРОЛЫ: где они в UI? Проверяем в разных режимах.
 *
 * Live: EQ_IN1/IN2 в файле есть, но в UI не видно.
 * Pro:  должен быть EQ_HP (10 полос).
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps2 = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

/** Что есть в UI: слайдеры, диала, комбобоксы с их областями. */
function uiInventory() {
  const { items } = dumpTree();
  return {
    total: items.length,
    sliders: items.filter((x) => x.cls === 'QSlider').length,
    dials: items.filter((x) => /Dial/.test(x.cls ?? '')).length,
    combos: items.filter((x) => /ComboBox/.test(x.cls ?? '')).length,
    buttons: items.filter((x) => x.cls === 'QPushButton').length,
    labels: items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim()).length,
  };
}

console.log('=== LIVE РЕЖИМ ===');
let ws = findActiveWorkspace();
console.log(`  workspace: ${ws.mode}/${ws.name}`);
let ini = readWorkspace(ws.path);
console.log(`  EQ-секции в файле: ${['EQ_IN1', 'EQ_IN2', 'EQ_HP'].filter((s) => ini[s]).join(', ') || 'нет'}`);
console.log(`  UI: ${JSON.stringify(uiInventory())}`);

console.log('\n=== ПЕРЕКЛЮЧАЮ НА PRO ЧЕРЕЗ HID ===');
// закрываем MCC, меняем режим, открываем
ps2('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(4000);

const HID = (await import('node-hid')).default;
const { buildFrame, withReportId } = await import('../protocol.js');
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', () => {});
dev.write([...withReportId(buildFrame(0x11, 0x1d, 3, true))]); // Pro
console.log('  отправил режим Pro, жду перезагрузку...');
await sleep(15000);

ps2('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);

ws = findActiveWorkspace();
console.log(`\n=== PRO РЕЖИМ ===`);
console.log(`  workspace: ${ws.mode}/${ws.name}`);
ini = readWorkspace(ws.path);
console.log(`  EQ-секции в файле: ${['EQ_IN1', 'EQ_IN2', 'EQ_HP'].filter((s) => ini[s]).join(', ') || 'нет'}`);
const inv = uiInventory();
console.log(`  UI: ${JSON.stringify(inv)}`);

// что за EQ_HP
if (ini.EQ_HP) {
  console.log('\n  EQ_HP содержимое:');
  for (const [k, v] of Object.entries(ini.EQ_HP)) {
    console.log(`    ${k} = ${v}`);
  }
}

// ищем слайдеры EQ (в Pro их должно быть 10 для EQ_HP)
console.log('\n=== СЛАЙДЕРЫ В PRO ===');
const { items } = dumpTree();
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
