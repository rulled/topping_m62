/**
 * НАЖАТЬ 48V в MCC — вызывается из скрипта захвата.
 *
 * Ищет кнопку по AutomationId, оканчивающемуся на PushButton48V
 * внутри Input_IN1, читает состояние, нажимает, ждёт и нажимает
 * обратно — чтобы устройство вернулось в исходное состояние.
 *
 * Печатает, что произошло, для лога.
 *
 * Запуск: node src/tools/press-48v.js
 */

import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 60000 }).trim();
  } catch (e) {
    return `ERR:${String(e.message).slice(0, 100)}`;
  }
};

const PRELUDE = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
`;

function find48v() {
  return ps(`${PRELUDE}
foreach ($e in $all) {
  $a = $e.Current.AutomationId
  if ($a -match 'Input_IN1\\.' -and $a.EndsWith('PushButton48V')) {
    $tp = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
      Write-Output ([System.Windows.Automation.TogglePattern]$tp).Current.ToggleState
    } else { Write-Output "NO_TOGGLE" }
    exit 0
  }
}
Write-Output "NOT_FOUND"
`);
}

function press() {
  return ps(`${PRELUDE}
foreach ($e in $all) {
  $a = $e.Current.AutomationId
  if ($a -match 'Input_IN1\\.' -and $a.EndsWith('PushButton48V')) {
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke()
      Write-Output "PRESSED"
      exit 0
    }
    Write-Output "NO_INVOKE"; exit 2
  }
}
Write-Output "NOT_FOUND"
`);
}

async function main() {
  const before = find48v();
  console.log(`48V до: ${before}`);

  if (before === 'NOT_FOUND' || before === 'NO_WINDOW') {
    console.log('кнопка 48V не найдена — захват всё равно покажет, что шлёт MCC');
    process.exit(0);
  }

  console.log('нажимаю 48V (включить)…');
  console.log(`  ${press()}`);
  await sleep(2500);
  console.log(`48V после включения: ${find48v()}`);

  // оставляем включённым на 4 секунды, чтобы кадр точно попал в захват
  await sleep(4000);

  console.log('нажимаю 48V (выключить, вернуть)…');
  console.log(`  ${press()}`);
  await sleep(2500);
  console.log(`48V после выключения: ${find48v()}`);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
