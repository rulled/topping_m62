/**
 * ЧТО ТАКОЕ 0x11:0x19, ЕСЛИ ЭТО НЕ 48V.
 *
 * ═══ ПРОТИВОРЕЧИЕ ═══
 *
 * Опыт 1 (prove-48v-tag.js): нажал кнопку 48V -> 0x11:19 изменился
 * 0 -> 1. Других изменений не было.
 *
 * Опыт 2 (probe-48v-precise.js): кнопка показала On -> Off, но
 * 0x11:19 остался 1.
 *
 * Оба не могут быть верны. Возможные объяснения:
 *
 *   A. 0x11:19 приходит только при изменении (событие), и если
 *      значение не менялось — устройство его не присылает. Тогда
 *      в опыте 2 снимок просто не содержал свежего значения
 *      (кэш прошлой сессии? нет, сессии разные).
 *
 *   B. 0x11:19 это НЕ 48V, а что-то, что случайно изменилось
 *      в опыте 1 (например, состояние порта 0x11:1c рядом).
 *
 *   C. Кнопка 48V в мобильном/Live режиме показывает состояние,
 *      но не управляет железом (48V есть только на IN1/IN2,
 *      а в Live они могут быть неактивны).
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Все теги 0x11:1x с их значениями — что вообще там лежит.
 * 2. Нажатие кнопки несколько раз с проверкой КАЖДОГО тега 0x11:1x.
 *
 * ═══ ВАЖНО ═══
 *
 * Сравниваем только ИЗМЕНЕНИЯ в тегах, присутствующих в обоих
 * снимках, и печатаем ВСЕ теги 0x11:1x всегда — чтобы видеть их
 * значения, даже если они не менялись.
 *
 * Запуск: node src/tools/what-is-11-19.js
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

async function fullSnap(min = 100, attempts = 3) {
  let best = new Map();
  for (let i = 1; i <= attempts; i++) {
    const dev = findDev();
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
    while (Date.now() - t0 < 16000) {
      for (let j = 0; j < 128; j++) {
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
    if (out.size > best.size) best = out;
    if (out.size >= min) return best;
    await sleep(2000);
  }
  return best;
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 45000 }).trim();
  } catch (e) { return `ERR`; }
};

function read48v() {
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
  if ($a -match 'Input_IN1\.' -and $a.EndsWith('PushButton48V')) {
    $tp = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
      Write-Output ([System.Windows.Automation.TogglePattern]$tp).Current.ToggleState
    } else { Write-Output "NO_TOGGLE" }
    exit 0
  }
}
Write-Output "NOT_FOUND"
`;
  return ps(script);
}

function press48v() {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
  $a = $e.Current.AutomationId
  if ($a -match 'Input_IN1\.' -and $a.EndsWith('PushButton48V')) {
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke(); Write-Output "OK"; exit 0
    }
    Write-Output "NO_INVOKE"; exit 2
  }
}
Write-Output "NOT_FOUND"
`;
  return ps(script);
}

/** Печатает все теги 0x11:1x и 0x21/0x22. */
function show(s, label) {
  console.log(`\n${label} (${s.size} тегов):`);
  const keys = [...s.keys()]
    .filter((k) => k.startsWith('11:1') || k.startsWith('21:') || k.startsWith('22:'))
    .sort();
  for (const k of keys) console.log(`  0x${k} = ${s.get(k)}`);
  if (!keys.length) console.log('   (нет тегов 0x11:1x / 0x21 / 0x22)');
}

async function main() {
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(3000);

  const s1 = await fullSnap();
  show(s1, 'СНИМОК 1 (MCC закрыт)');

  console.log('\nзапускаю MCC…');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(22000);

  const b = read48v();
  console.log(`кнопка 48V: ${b}`);

  // Нажимаем и сразу читаем HID ПАРАЛЛЕЛЬНО (MCC не мешает чтению)
  console.log('нажимаю 48V…');
  console.log(`  ${press48v()}`);
  await sleep(2500);

  console.log('кнопка после: ' + read48v());

  console.log('\nчитаю HID при работающем MCC (параллельное чтение)…');
  const s2 = await fullSnap();
  show(s2, 'СНИМОК 2 (MCC работает)');

  // Нажимаем ВТОРОЙ раз — вернуть как было
  console.log('\nнажимаю 48V второй раз (вернуть)…');
  console.log('  ' + press48v());
  await sleep(2500);
  console.log('кнопка после второго: ' + read48v());

  const s3 = await fullSnap();
  show(s3, 'СНИМОК 3 (после второго нажатия)');

  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(3000);

  const s4 = await fullSnap();
  show(s4, 'СНИМОК 4 (MCC закрыт)');

  console.log('\n' + '='.repeat(64));
  console.log('РАЗБОР');
  console.log('='.repeat(64));

  const watch = ['11:19', '11:1a', '11:1b', '11:1c', '11:1e'];
  console.log('  тег      снимок1  снимок2  снимок3  снимок4');
  for (const k of watch) {
    const fmt = (m) => String(m.get(k) ?? '—').padStart(7);
    console.log(`  0x${k} ${fmt(s1)} ${fmt(s2)} ${fmt(s3)} ${fmt(s4)}`);
  }

  console.log(`
  Если 0x11:19 не меняется при нажатии — значит в опыте 1
  изменился не он, а что-то другое (я смотрел только 0x11:19).

  Если меняется только в снимке 2 (при работающем MCC) — это
  состояние, которое MCC держит, а устройство отражает.

  Смотри таблицу выше: какой тег меняется 0/1/0/0 или подобным
  образом — тот и связан с 48V.
  `);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
