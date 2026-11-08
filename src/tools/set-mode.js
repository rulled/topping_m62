/**
 * Смена режима устройства через UI MCC с ожиданием переподключения.
 *
 * Смена режима ПЕРЕЗАГРУЖАЕТ устройство: HID пропадает на ~6-10 секунд.
 * После переподключения ждём и снимаем состояние.
 *
 * Запуск:
 *   node src/tools/set-mode.js --to pro|live|mobile
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODES = { mobile: 0, live: 1, pro: 2 };

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }
const to = arg('to', 'live');
if (!(to in MODES)) { console.error('укажи --to pro|live|mobile'); process.exit(1); }

// найти индекс комбобокса режима
function findModeCombo() {
  const { items } = dumpTree();
  // режим — комбобокс ниже подписи "Mode select"
  const lbl = items.find((x) => (x.name || '').trim() === 'Mode select');
  if (!lbl) return null;
  const cands = items.filter(
    (x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - lbl.ly) < 30,
  );
  return cands.length ? cands[0].i : null;
}

function readMode() {
  const { items } = dumpTree();
  const lbl = items.find((x) => (x.name || '').trim() === 'Mode select');
  if (!lbl) {
    const buses = items.filter((x) => /^Mix [A-H]$/.test(x.name || '') && x.cls === 'QLabel');
    return { modeText: null, buses: buses.length };
  }
  const le = items.filter((x) => x.cls === 'QLineEdit' && Math.abs(x.ly - lbl.ly) < 30);
  const buses = items.filter((x) => /^Mix [A-H]$/.test(x.name || '') && x.cls === 'QLabel');
  return { modeText: le.length ? le[0].name : null, buses: buses.length };
}

console.log('=== ДО ===');
console.log(JSON.stringify(readMode(), null, 1));

const idx = findModeCombo();
if (idx === null) { console.error('комбобокс режима не найден — открой настройки'); process.exit(1); }
console.log(`комбобокс режима: idx=${idx}`);

const down = MODES[to] - MODES.live; // относительно Live
console.log(`переключаю на "${to}" (${down >= 0 ? '+' : ''}${down} от текущего предположения)`);

const ACT = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$e.SetFocus()
Start-Sleep -Milliseconds 300
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.ExpandCollapsePattern]$pat).Expand()
  Start-Sleep -Milliseconds 400
}
Add-Type -AssemblyName System.Windows.Forms
# в начало списка, затем нужное число вниз
[System.Windows.Forms.SendKeys]::SendWait("{HOME}")
Start-Sleep -Milliseconds 200
for ($k=0; $k -lt ${MODES[to]}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
  Start-Sleep -Milliseconds 150
}
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "SENT"
`);
console.log('  ' + ACT);

console.log('\nжду перезагрузки устройства...');
let seen = false;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  if (found.length === 0) {
    seen = false;
    if (i % 3 === 0) process.stdout.write(`  ${i}s: устройство пропало\n`);
  } else if (!seen) {
    seen = true;
    console.log(`  ${i}s: устройство вернулось`);
    break;
  }
}
await sleep(3000);

console.log('\n=== ПОСЛЕ ===');
console.log(JSON.stringify(readMode(), null, 1));

// снять состояние с устройства
const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
if (vp) {
  const dev = new HID.HID(vp.path);
  const latest = new Map();
  let cap = null;
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    const k = (m.target << 8) | m.prop;
    latest.set(k, m.value);
    if (cap) cap.set(k, m.value);
  });
  const s = new Map(latest);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(3000);
  cap = null;
  console.log(`\nпараметров с устройства: ${s.size}`);
  for (const [t, nm] of Object.entries({ 0x1104: 'Brightness', 0x111d: 'Mode', 0x111a: 'Bluetooth', 0x111c: 'UsbC', 0x1122: 'BtnSingle', 0x1123: 'BtnDouble' })) {
    const k = Number(t);
    const v = s.get(k);
    console.log(`  0x${k.toString(16).padStart(4, '0')}  ${nm.padEnd(12)} = ${v === undefined ? '(нет)' : v}`);
  }
  dev.close();
}
process.exit(0);
