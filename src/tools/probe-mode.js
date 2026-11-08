/**
 * Поймать значение 0x11:0x1d (режим) сразу после смены режима.
 *
 * Устройство перезагружается при смене режима, поэтому значение нужно
 * прочитать в первые секунды после возврата HID.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }
const target = arg('to', 'live');   // mobile|live|pro
const ORDER = { mobile: 0, live: 1, pro: 2 };

// 1) найти комбобокс режима
const { items } = dumpTree();
const lbl = items.find((x) => (x.name || '').trim() === 'Mode select');
if (!lbl) {
  console.error('открой настройки (вкладка Device)');
  process.exit(1);
}
const combo = items.find((x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - lbl.ly) < 30);
if (!combo) { console.error('комбобокс режима не найден'); process.exit(1); }

// 2) выставить режим
const n = ORDER[target];
console.log(`переключаю режим на "${target}" (idx комбо=${combo.i}, down×${n})`);
console.log('  ' + ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${combo.i})
$e.SetFocus()
Start-Sleep -Milliseconds 250
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$pat).Expand()
  Start-Sleep -Milliseconds 350
}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("{HOME}")
Start-Sleep -Milliseconds 150
for ($k=0; $k -lt ${n}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
  Start-Sleep -Milliseconds 120
}
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "SENT"
`));

// 3) ждать появления HID и сразу опросить
console.log('\nжду HID и читаю состояние...');
let dev = null;
for (let i = 0; i < 45; i++) {
  await sleep(700);
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = found.find((d) => d.interface === IFACE);
  if (!vp) { process.stdout.write('.'); continue; }
  try {
    dev = new HID.HID(vp.path);
    break;
  } catch { process.stdout.write('x'); }
}
if (!dev) { console.log('\nустройство не вернулось'); process.exit(1); }
console.log(`\nHID открыт на ${((Date.now()) % 100000)}`);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

// усиленно опрашиваем первые 6 секунд
for (let round = 0; round < 6; round++) {
  cap = seen;
  try { dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]); } catch { /* ещё не готов */ }
  await sleep(900);
}
cap = null;

console.log(`\n=== состояние (${seen.size} параметров) ===`);
const NAMES = {
  0x1104: 'Brightness', 0x111a: 'Bluetooth', 0x111b: 'OtgDirection',
  0x111c: 'UsbCCharging', 0x111d: 'MODE (FirmwareSelected)', 0x111e: 'AutoPoweroff',
  0x1122: 'MainButtonSingle', 0x1123: 'MainButtonDouble', 0x1118: 'счётчик',
  0x1119: '0x19',
};
for (const [t, nm] of Object.entries(NAMES)) {
  const k = Number(t);
  const v = seen.get(k);
  const mark = k === 0x111d ? (v === undefined ? '  <<< НЕ ПРИШЁЛ' : '  <<< ЕСТЬ!') : '';
  console.log(`  0x${k.toString(16).padStart(4, '0')}  ${nm.padEnd(24)} = ${v === undefined ? '(нет)' : String(v).padStart(4)}${mark}`);
}

console.log('\nвсе TT=0x11:');
const t11 = [...seen.entries()].filter(([k]) => (k >> 8) === 0x11).sort((a, b) => a[0] - b[0]);
for (const [k, v] of t11) console.log(`  0x${k.toString(16)} = ${v}`);

dev.close();
process.exit(0);
