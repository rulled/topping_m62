/**
 * 48V: включить кнопкой в MCC и найти тег.
 *
 * ═══ ЧТО НАЙДЕНО ═══
 *
 * Кнопка есть в интерфейсе, AutomationId заканчивается на:
 *
 *   Input_IN1.frame.widgetPushButtonGroup3.frame.PushButton48V   (94, 200)
 *   Input_IN2.frame.widgetPushButtonGroup1.frame.PushButton48V   (249, 200)
 *
 * ═══ МЕТОД ═══
 *
 * 1. Снимок «до» (MCC закрыт).
 * 2. Запустить MCC.
 * 3. Инвокнуть кнопку 48V для IN1.
 * 4. Снимок «после» — параллельно, чтение с MCC работает.
 * 5. Тег, изменившийся 0 -> 1, это 48V.
 * 6. Выключить обратно.
 *
 * ═══ ВАЖНО ═══
 *
 * Сравниваем только ИЗМЕНЕНИЯ значения, не появление/пропажу:
 * дамп плавает, и «появился» может быть удачной сессией.
 *
 * Запуск: node src/tools/prove-48v-tag.js
 */

import HID from 'node-hid';
import { execFileSync } from 'node:child_process';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function snap(ms = 14000) {
  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try { buf = h.readTimeout(1); } catch { break; }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) { send(0x11, PP_SUBSCRIBE, 1); lk = Date.now(); }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }
  return out;
}

const NOISE = new Set([
  '11:18', '21:01', '25:01', '26:01',
  '31:15', '32:15', '33:15', '34:15', '35:15', '36:15',
  '39:01', '39:02', '44:0d', '44:0e',
  '46:09', '46:0a', '46:0c', '46:0d',
  '61:01', '62:01', '63:01', '64:01', '9b:0b',
]);

function diff(a, b) {
  const out = [];
  for (const [k, v] of b) {
    if (NOISE.has(k)) continue;
    const was = a.get(k);
    if (was !== undefined && was !== v) out.push({ key: k, from: was, to: v });
  }
  return out;
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 40000 }).trim();
  } catch (e) { return `ERR: ${String(e.message).slice(0, 100)}`; }
};

/** Инвокает кнопку по концу AutomationId. */
function press48v(which) {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
$state = ''
foreach ($e in $all) {
  $a = $e.Current.AutomationId
  if ($a -match "Input_${which}\." -and $a.EndsWith('PushButton48V')) {
    $target = $e
    $pat = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
      $state = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState
    }
    break
  }
}
if ($null -eq $target) { Write-Output "NOT_FOUND"; exit 2 }
Write-Output "BEFORE:$state"

$ip = $null
if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
  ([System.Windows.Automation.InvokePattern]$ip).Invoke()
  Write-Output "INVOKED"
} else {
  Write-Output "NO_INVOKE"
}
`;
  return ps(script);
}

/** Читает состояние кнопки, не нажимая. */
function read48v(which) {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
  $a = $e.Current.AutomationId
  if ($a -match "Input_${which}\." -and $a.EndsWith('PushButton48V')) {
    $pat = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
      Write-Output ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState
    } else { Write-Output "NO_TOGGLE" }
    exit 0
  }
}
Write-Output "NOT_FOUND"
`;
  return ps(script);
}

async function main() {
  console.log('снимок «до»…');
  const before = await snap();
  console.log(`  ${before.size} тегов\n`);

  const running = Number(ps("(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count")) > 0;
  if (!running) {
    console.log('запускаю MCC…');
    ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
    await sleep(22000);
  }

  console.log(`состояние кнопки 48V (IN1): ${read48v('IN1')}`);
  console.log('\nнажимаю 48V для IN1…');
  const out = press48v('IN1');
  console.log(`  ${out}`);

  await sleep(3000);
  console.log(`  состояние после: ${read48v('IN1')}`);

  console.log('\nснимок «после» (MCC запущен, чтение параллельно)…');
  const after = await snap();
  console.log(`  ${after.size} тегов`);

  const d = diff(before, after);
  console.log('');
  console.log('='.repeat(60));
  console.log('ИЗМЕНЕНИЯ');
  console.log('='.repeat(60));
  if (!d.length) {
    console.log('  тег не изменился — 48V через HID не сообщается');
  } else {
    for (const x of d) console.log(`  0x${x.key}  ${x.from} -> ${x.to}`);
  }

  // --- выключаем обратно ---
  console.log('\nвыключаю 48V обратно…');
  press48v('IN1');
  await sleep(2000);
  console.log(`  состояние: ${read48v('IN1')}`);

  console.log('\nзакрываю MCC…');
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(3000);

  const fin = await snap();
  console.log('\nконтрольный снимок после закрытия:');
  for (const k of ['11:19', '11:1a', '11:1b', '11:1e', '12:02', '12:03']) {
    console.log(`  0x${k} = ${fin.get(k)}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
