/**
 * ГИПОТЕЗА: 0x1118 = заряд батареи (%), 0x1119 = статус зарядки.
 *
 * Доказательства:
 *   - значения 0x1118 всегда 0..100 (72, 78, 91, 92, 96, 98, 99)
 *   - в UI есть виджет BatteryS1M1
 *   - 0x1119 = 0 или 1 (флаг)
 *
 * Проверяем: что показывает BatteryS1M1 в UI.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) HID-значения
const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
let hidVals = {};
if (found.length) {
  const vp = found.find((d) => d.interface === 4);
  const dev = new HID.HID(vp.path);
  const seen = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(4500);
  hidVals = {
    x1118: seen.get(0x1118),
    x1119: seen.get(0x1119),
    x1101: seen.get(0x1101),
    x1125: seen.get(0x1125),
  };
  try { dev.close(); } catch { /* */ }
}

console.log('=== HID ===');
console.log(' ', JSON.stringify(hidVals));

// 2) Battery-виджет в UI
console.log('\n=== UI: Battery-виджеты ===');
const { items } = dumpTree();
const battery = items.filter((x) => /Battery/i.test(x.cls ?? ''));
console.log(`  найдено Battery-элементов: ${battery.length}`);
for (const b of battery) {
  console.log(`  [${b.i}] ${b.cls} (${b.lx},${b.ly}) "${(b.name || '').slice(0, 30)}"`);

  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${b.i})`,
    '$o = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $o += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $rv=[System.Windows.Automation.RangeValuePattern]$p; $o += "R=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]" }',
    'if ($e.Current.Name) { $o += "NAME=" + $e.Current.Name }',
    'if ($o.Count -eq 0) { Write-Output "нет паттернов" } else { Write-Output ($o -join " ") }',
  ].join('\n');
  try { console.log(`        ${ps(RAW).trim()}`); } catch { /* */ }
}

// 3) ищем подписи с процентом
console.log('\n=== подписи с процентами или Battery ===');
const pct = items.filter((x) => x.name && /%|battery|заряд/i.test(x.name));
for (const p of pct) console.log(`  [${p.i}] ${p.cls} (${p.lx},${p.ly}) "${p.name}"`);
if (!pct.length) console.log('  нет');
