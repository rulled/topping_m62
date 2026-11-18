/**
 * Проверка ComboBox-настроек: OTG power, USB-C power.
 *
 * Выбирает пункты по кругу и смотрит, какое значение получает устройство.
 *
 * Запуск: node src/tools/probe-power.js
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const vp = found.find((d) => d.interface === IFACE);
  if (!vp) return null;
  try { return new HID.HID(vp.path); } catch { return null; }
}
let dev = connect();
if (!dev) { console.error('M62 не найден'); process.exit(1); }

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

async function snap(ms = 1800) {
  const s = new Map(seen);
  cap = s;
  try { dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]); } catch { /* ok */ }
  await sleep(ms);
  cap = null;
  return s;
}
const hex = (k) => '0x' + k.toString(16).padStart(4, '0');

/** Выбрать пункт N (0-based) в комбобоксе через клавиатуру. */
function choose(comboIdx, n) {
  return ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${comboIdx})
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
Start-Sleep -Milliseconds 300
$val = ''
if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
  $val = ([System.Windows.Automation.ValuePattern]$pat).Current.Value
}
Write-Output ("NOW=" + $val)
`);
}

async function testCombo(label, tag, count) {
  const { items } = dumpTree();
  const lbl = items.find((x) => (x.name || '').trim() === label);
  if (!lbl) { console.log(`\n### ${label}: подпись не найдена`); return; }
  const combo = items.find((x) => x.cls === 'ComboBoxS1M3' && Math.abs(x.ly - lbl.ly) < 30);
  if (!combo) { console.log(`\n### ${label}: комбобокс не найден`); return; }

  console.log(`\n### ${label}  (комбо [${combo.i}], тег ${hex(tag)})`);
  for (let n = 0; n < count; n++) {
    const r = choose(combo.i, n);
    const v = (r.match(/NOW=(.*)/) ?? [])[1] ?? '?';
    await sleep(900);
    const s = await snap();
    console.log(`   пункт ${n}: "${v}"  ->  ${hex(tag)} = ${s.get(tag) === undefined ? '(нет)' : s.get(tag)}`);
  }
}

await testCombo('OTG port power setting', 0x111b, 3);
await testCombo('USB-C port power setting', 0x111c, 3);

dev.close();
process.exit(0);
