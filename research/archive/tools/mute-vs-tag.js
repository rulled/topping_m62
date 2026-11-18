/**
 * Решающий тест: отражает ли 0x64:0x04 / 0x62:0x04 состояние мьюта.
 *
 * Метод: переключаем кнопку MUTE в UI MCC (TogglePattern — эталон,
 * NOTES §про mute) и смотрим, меняется ли значение тега.
 *
 * Безопасность: только мьют. Худший исход — тишина; её снимаем тем же
 * переключателем в конце.
 *
 * Запуск: node src/tools/mute-vs-tag.js [hp|otg]
 */

import { execFileSync } from 'node:child_process';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const WHICH = (process.argv[2] ?? 'hp').toLowerCase();
const VID = 0x152a;
const PID = 0x875c;
const TARGET = WHICH === 'hp' ? 0x64 : 0x62;
const PROP = 0x04;
const NEEDLE = WHICH === 'hp' ? 'Output_HP' : 'Output_OTGOUT';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PS_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DpiQ {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DpiQ]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "MCC_NOT_RUNNING"; exit 0 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$needle = "__NEEDLE__"
$doToggle = "__TOGGLE__" -eq "yes"
$btn = $null
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -like "*$needle*frame.PushButtonMUTE") { $btn = $e; break }
}
if ($btn -eq $null) { Write-Output "NOT_FOUND"; exit 0 }
$tp = $btn.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
if ($doToggle) {
  $tp.Toggle()
  Start-Sleep -Milliseconds 1400
  $tp2 = $btn.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  Write-Output ("STATE=" + $tp2.Current.ToggleState)
} else {
  Write-Output ("STATE=" + $tp.Current.ToggleState)
}
`;

function ui(doToggle = false) {
  const script = PS_SCRIPT
    .replace('__NEEDLE__', NEEDLE)
    .replace('__TOGGLE__', doToggle ? 'yes' : 'no');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const line = out.trim().split(/\r?\n/).pop() ?? '';
    return line.startsWith('STATE=') ? line.slice(6).trim() : line;
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}
const h = new HID.HID(dev.path);
const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

/** Читает последнее значение тега, держа поток открытым ms. */
async function readTag(ms = 7000) {
  const t0 = Date.now();
  let val = null;
  while (Date.now() - t0 < ms) {
    let buf;
    try {
      buf = h.readTimeout(30);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let f = bytes;
    if (!(bytes[0] === 0x22 && bytes[1] === 0x33) && bytes[1] === 0x22) f = bytes.subarray(1);
    if (f.length < 15 || f[0] !== 0x22 || f[1] !== 0x33) continue;
    if (f[13] !== 0x66 || f[14] !== 0x77) continue;
    if (f[5] === TARGET && f[6] === PROP) val = f.readInt32BE(7);
  }
  return val;
}

async function snapshot(label) {
  send(0x11, 0x24, 1);
  await sleep(250);
  send(0x11, 0x26, 1);
  const tag = await readTag(9000);
  const state = ui(false);
  console.log(`  ${label.padEnd(22)} UI=${String(state).padEnd(4)}  tag(0x04)=${tag}`);
  return { tag, state };
}

const main = async () => {
  console.log(`=== ${WHICH.toUpperCase()}: связано ли 0x04 с мьютом? ===`);
  const keepalive = setInterval(() => { try { send(0x11, 0x24, 1); } catch { /* ok */ } }, 2000);

  const a = await snapshot('исходно');
  if (a.state.includes('ERROR') || a.state === 'NOT_FOUND' || a.state === 'MCC_NOT_RUNNING') {
    console.log(`Стоп: не читается UI (${a.state}). Ничего не переключаю.`);
    clearInterval(keepalive);
    h.close();
    return;
  }

  console.log('  переключаю MUTE в UI ...');
  const newState = ui(true);
  console.log(`  UI после переключения: ${newState}`);
  const b = await snapshot('после переключения UI');

  console.log('  возвращаю MUTE в UI ...');
  const backState = ui(true);
  console.log(`  UI после возврата: ${backState}`);
  const c = await snapshot('после возврата');

  console.log('\n=== ИТОГ ===');
  const followed = a.tag !== b.tag;
  console.log(`тег 0x04 изменился вслед за UI: ${followed ? 'ДА — это и есть мьют' : 'НЕТ — это не мьют'}`);
  console.log(`  было ${a.tag} (UI ${a.state}) -> стало ${b.tag} (UI ${b.state})`);
  console.log(`состояние вернулось:          ${c.state === a.state ? 'ДА' : `НЕТ (UI ${c.state})`}`);

  clearInterval(keepalive);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
