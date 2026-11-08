/**
 * EQ В PRO-РЕЖИМЕ: пишется ли Switch и есть ли UI-контролы?
 *
 * В Live EQ не включается. Проверяем Pro — там EQ_HP (10 полос).
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
/** Запустить PowerShell, не падая на ненулевом коде выхода. */
const ps2 = (cmd) => {
  try {
    return execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

// 1) переключаем в Pro
console.log('=== 1. переключаю в Pro ===');
ps2('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(4000);

const HID = (await import('node-hid')).default;
const { buildFrame, withReportId } = await import('../protocol.js');
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', () => {});
dev.write([...withReportId(buildFrame(0x11, 0x1d, 3, true))]);
console.log('  отправил Pro, жду перезагрузку...');

// ждём, пока режим реально сменится
let ws = null;
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  try { dev.close(); } catch { /* */ }
  try {
    ws = findActiveWorkspace();
    if (ws.mode === 'Prof') break;
  } catch { /* устройство перезагружается */ }
}
console.log(`  workspace после ожидания: ${ws?.mode}/${ws?.name}`);

if (!ws || ws.mode !== 'Prof') {
  console.log('  ERROR: режим не переключился на Pro — прерываю');
  process.exit(1);
}

// 2) смотрим workspace
console.log(`  workspace: ${ws.mode}/${ws.name}`);
let ini = readWorkspace(ws.path);
if (!ini.EQ_HP) {
  console.log(`  ERROR: в ${ws.name} нет секции EQ_HP — это не Pro-файл`);
  console.log(`  секции: ${Object.keys(ini).join(', ')}`);
  process.exit(1);
}

// 3) пишем EQ_HP.Switch = 1
console.log('\n=== 2. пишу EQ_HP.Switch = 1 и меняю полосу ===');
ini = readWorkspace(ws.path);
const before = { sw: ini.EQ_HP?.Switch, b1: ini.EQ_HP?.['Eq%401'] };
console.log('  до:', JSON.stringify(before));

ini.EQ_HP.Switch = '1';
ini.EQ_HP['Eq%401'] = '0|6|40|0.7|1';
writeWorkspace(ws.path, ini);
ini = readWorkspace(ws.path);
console.log('  записал:', JSON.stringify({ sw: ini.EQ_HP?.Switch, b1: ini.EQ_HP?.['Eq%401'] }));

// 4) запускаем MCC
console.log('\n=== 3. запускаю MCC ===');
ps2('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(16000);

const after = readWorkspace(findActiveWorkspace().path);
console.log('\n=== 4. РЕЗУЛЬТАТ ===');
console.log('  EQ_HP.Switch:', after.EQ_HP?.Switch);
console.log('  Eq%401:', after.EQ_HP?.['Eq%401']);
const switchOk = after.EQ_HP?.Switch === '1';
const bandOk = String(after.EQ_HP?.['Eq%401']).includes('|40|');
console.log(`  Switch записан: ${switchOk ? 'ДА' : 'нет'}`);
console.log(`  полоса записана: ${bandOk ? 'ДА' : 'нет'}`);

// 5) ищем UI-контролы EQ
console.log('\n=== 5. UI В PRO ===');
const { items } = dumpTree();
console.log(`  элементов: ${items.length}`);
console.log('  подписи:');
for (const l of items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim())) {
  console.log(`    [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.slice(0, 28)}"`);
}
console.log('  слайдеры:');
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
  console.log(`    [${String(s.i).padStart(3)}] (${String(s.lx).padStart(4)},${String(s.ly).padStart(4)}) ${ps(RAW).trim()}`);
}
