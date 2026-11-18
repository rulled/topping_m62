/**
 * ЧТЕНИЕ ВСЕХ НАСТРОЕК ИЗ UI MCC + снимок HID.
 *
 * Показывает, что сейчас выбрано в каждом комбобоксе настроек,
 * и какие значения при этом на устройстве.
 *
 * Ничего не меняет.
 */
import { dumpTree, ps, PRELUDE } from './uia.js';
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

// прочитать текстовые значения комбобоксов и переключателей
const RAW = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $cls = $e.Current.ClassName
  if ($cls -notmatch 'ComboBox|QPushButton|QLineEdit') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cy = $r.Y + $r.Height/2
  if ($cy -lt 380 -or $cy -gt 1300) { continue }

  $val = ''
  $pat = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
    $val = ([System.Windows.Automation.ValuePattern]$pat).Current.Value
  }
  $tog = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $tog = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  $out += [pscustomobject]@{
    i = $i; cls = $cls; name = $e.Current.Name;
    y = [int]$cy; x = [int]($r.X + $r.Width/2); value = $val; toggle = $tog
  }
}
$out | ConvertTo-Json -Compress -Depth 3
`);

const rows = JSON.parse(RAW);
const list = Array.isArray(rows) ? rows : [rows];

// подписи настроек по Y
const LABELS = {
  437: 'Bluetooth',
  537: 'Brightness',
  635: 'OTG port power setting',
  734: 'USB-C port power setting',
  834: 'Mode select',
  934: 'Auto Power On/Off',
  1032: 'Reset to factory default',
  1132: 'Main button single-click',
  1231: 'Main button double-click',
};

console.log('=== НАСТРОЙКИ В UI M CONTROL CENTER ===\n');
for (const [yStr, label] of Object.entries(LABELS)) {
  const y = Number(yStr);
  const near = list.filter((r) => Math.abs(r.y - y) < 25 && (r.value || r.toggle));
  console.log(`${label}:`);
  if (!near.length) {
    console.log('   (не найдено значение)');
    continue;
  }
  for (const r of near) {
    const v = r.value ? `"${r.value}"` : '';
    const t = r.toggle ? `toggle=${r.toggle}` : '';
    console.log(`   [${r.i}] ${r.cls.padEnd(16)} ${v} ${t}`.trimEnd());
  }
  console.log();
}

// --- HID снимок ---
const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.log('M62 не найден для HID-снимка'); process.exit(0); }
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

const snap = new Map(latest);
capture = snap;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3000);
capture = null;

console.log('=== ЗНАЧЕНИЯ НА УСТРОЙСТВЕ (TT=0x11) ===\n');
const NAMES = {
  0x1104: 'Brightness',
  0x1118: 'счётчик',
  0x1119: '(0x19)',
  0x111a: 'Bluetooth',
  0x111b: 'OtgDirection',
  0x111c: 'UsbCCharging',
  0x111d: 'FirmwareSelected (mode)',
  0x111e: 'AutoPoweroff',
  0x1122: 'MainButtonSingle',
  0x1123: 'MainButtonDouble',
};
for (const [tag, nm] of Object.entries(NAMES)) {
  const k = Number(tag);
  const v = snap.get(k);
  const hx = '0x' + k.toString(16).padStart(4, '0');
  console.log(`  ${hx}  ${nm.padEnd(24)} = ${v === undefined ? '(не пришло)' : v}`);
}

dev.close();
process.exit(0);
