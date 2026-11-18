/**
 * Проверка: управляет ли 0x64:0x04 / 0x62:0x04 мьютом выхода.
 *
 * БЕЗОПАСНОСТЬ: тест пишет только 1 (замьючить) и затем возвращает
 * состояние, которое было в UI до теста. Появление звука невозможно:
 * худший исход — выход остаётся замьюченным.
 *
 * Чтение состояния — только через UI MCC (`TogglePattern`), это
 * эталон (NOTES: «device mute → UI TogglePattern»). Собственную
 * подписку НЕ делаем, чтобы не конкурировать с MCC за чтение HID:
 * устройства-события разбирает MCC, а мы лишь пишем.
 *
 * Запуск: node src/tools/test-output-mute.js [hp|otg]
 */

import { execFileSync } from 'node:child_process';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const WHICH = (process.argv[2] ?? 'hp').toLowerCase();
const VID = 0x152a;
const PID = 0x875c;
const TARGET = WHICH === 'hp' ? 0x64 : 0x62;
const PROP = 0x04;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PS_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DpiZ {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DpiZ]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "MCC_NOT_RUNNING"; exit 0 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
if ($root -eq $null) { Write-Output "NO_ROOT"; exit 0 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$needle = "__NEEDLE__"
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.AutomationId -like "*$needle*frame.PushButtonMUTE") {
    $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    Write-Output ("UI=" + $tp.Current.ToggleState)
    exit 0
  }
}
Write-Output "BUTTON_NOT_FOUND"
`;

function uiMuteState() {
  const needle = WHICH === 'hp' ? 'Output_HP' : 'Output_OTGOUT';
  const script = PS_SCRIPT.replace('__NEEDLE__', needle);
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const line = out.trim().split(/\r?\n/).pop() ?? '';
    return line.startsWith('UI=') ? line.slice(3).trim() : line;
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
const write = (v) => h.write([...withReportId(buildFrame(TARGET, PROP, v, true))]);

const main = async () => {
  console.log(`=== мьют ${WHICH.toUpperCase()}: тег ${TARGET.toString(16)}:0x04 ===`);

  const before = uiMuteState();
  console.log(`UI до теста:        ${before}`);
  if (!before || before.startsWith('ERROR') || !before.includes('On') && !before.includes('Off')) {
    console.log(`Стоп: не удалось прочитать UI (${before}). Ничего не пишу.`);
    h.close();
    return;
  }

  const wasOn = before.includes('On');

  console.log('пишу 1 (mute) ...');
  write(1);
  await sleep(1500);
  const afterMute = uiMuteState();
  console.log(`UI после mute:      ${afterMute}`);

  // Возвращаем то, что было до теста (0, если было Off).
  const restore = wasOn ? 1 : 0;
  console.log(`возвращаю ${restore} ...`);
  write(restore);
  await sleep(1500);
  const afterRestore = uiMuteState();
  console.log(`UI после отката:    ${afterRestore}`);

  const muteWorked = afterMute.includes('On') && !wasOn;
  const restored = afterRestore === before;

  console.log('\n=== ИТОГ ===');
  console.log(`UI среагировал на 0x04=1:  ${muteWorked ? 'ДА — тег управляет мьютом' : 'нет'}`);
  console.log(`состояние вернулось:       ${restored ? 'ДА' : `НЕТ (${afterRestore})`}`);

  h.close();
  if (!restored) {
    console.log(`\nВНИМАНИЕ: верните мьют ${WHICH.toUpperCase()} вручную в MCC.`);
  }
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  try { h.close(); } catch { /* ok */ }
  process.exit(1);
});
