/**
 * Выбор пункта в комбобоксе ЧЕРЕЗ КЛАВИАТУРУ.
 *
 * Qt не отдаёт пункты через UIA, но реагирует на клавиатуру:
 * фокус на комбобокс -> Down -> Enter.
 *
 * Запуск:
 *   node src/tools/combo-key.js --idx 50 --down 2 --label "MainButtonSingle"
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const idx = Number(arg('idx', '-1'));
const down = Number(arg('down', '1'));
const label = arg('label', 'combo');

const ACT = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
# поставить фокус
$e.SetFocus()
Start-Sleep -Milliseconds 300
# раскрыть
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$pat).Expand()
  Start-Sleep -Milliseconds 400
}
Add-Type -AssemblyName System.Windows.Forms
for ($k=0; $k -lt ${down}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
  Start-Sleep -Milliseconds 150
}
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 400
$val = ''
if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
  $val = ([System.Windows.Automation.ValuePattern]$pat).Current.Value
}
Write-Output ("NOW=" + $val)
`);

console.log(`КОМБОБОКС: ${label} (idx=${idx}), нажимаю Down × ${down}`);
console.log('  ' + ACT);

// HID снимок
const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.log('M62 не найден'); process.exit(0); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latest = new Map();
let capture = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});
await sleep(1200);
const s = new Map(latest);
capture = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(2200);
capture = null;

const NAMES = {
  0x1104: 'Brightness', 0x111a: 'Bluetooth', 0x111b: 'OtgDirection',
  0x111c: 'UsbCCharging', 0x111d: 'Mode', 0x111e: 'AutoPoweroff',
  0x1122: 'MainButtonSingle', 0x1123: 'MainButtonDouble', 0x1118: 'счётчик',
};
console.log('\n=== ЗНАЧЕНИЯ НА УСТРОЙСТВЕ ===');
for (const [t, nm] of Object.entries(NAMES)) {
  const k = Number(t);
  const v = s.get(k);
  if (v !== undefined) console.log(`  0x${k.toString(16).padStart(4,'0')}  ${nm.padEnd(20)} = ${v}`);
}
dev.close();
process.exit(0);
