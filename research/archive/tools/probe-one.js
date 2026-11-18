/**
 * Точечная проверка одного слайдера с подтверждением, что значение
 * реально изменилось в UI, и с длинным окном ANNOUNCE.
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const PS_EXE = 'powershell.exe';

const idx = Number(process.argv[2] ?? '146');
const val = Number(process.argv[3] ?? '12');

const GETVAL = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$pat = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) {
  $rv = [System.Windows.Automation.RangeValuePattern]$pat
  Write-Output ("val=" + $rv.Current.Value + " min=" + $rv.Current.Minimum + " max=" + $rv.Current.Maximum + " ro=" + $rv.Current.IsReadOnly)
} else { Write-Output "NO-PATTERN" }
`;

const SETVAL = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$pat = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) { Write-Output "NO-PATTERN"; exit 1 }
$rv = [System.Windows.Automation.RangeValuePattern]$pat
$rv.SetValue(${val})
Start-Sleep -Milliseconds 300
Write-Output ("after=" + $rv.Current.Value)
`;

function ps(cmd) {
  return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let capture = null;
const latest = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = `${m.target.toString(16).padStart(2, '0')}:${m.prop.toString(16).padStart(2, '0')}`;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});

async function snap(ms = 3000) {
  const s = new Map(latest);
  capture = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  capture = null;
  return s;
}

(async () => {
  console.log(`слайдер ${idx}, ставим ${val}\n`);
  console.log('состояние UI до:  ' + ps(GETVAL));

  const before = await snap();
  console.log(`снимок ДО: ${before.size} параметров`);

  console.log('ставлю:           ' + ps(SETVAL));
  await sleep(1200);
  console.log('состояние UI после: ' + ps(GETVAL));

  const after = await snap();
  console.log(`снимок ПОСЛЕ: ${after.size} параметров\n`);

  console.log('DIFF (без метров):');
  let n = 0;
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k), b = after.get(k);
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100) continue;
    console.log(`  ${k.padEnd(8)} ${a} -> ${b}`);
    n++;
  }
  if (!n) console.log('  (нет)');

  dev.close();
  process.exit(0);
})();
