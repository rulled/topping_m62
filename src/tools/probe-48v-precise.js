/**
 * 48V: ЧТО ИМЕННО МЕНЯЕТСЯ ПРИ ПЕРЕКЛЮЧЕНИИ.
 *
 * ═══ ЧТО ПОШЛО НЕ ТАК В ПРОШЛЫЙ РАЗ ═══
 *
 * Первый снимок дал 90 тегов вместо 102, поэтому в разницу попали
 * «появившиеся» метры — это шум неполного дампа, а не эффект 48V.
 *
 * ═══ КАК ПРАВИЛЬНО ═══
 *
 * 1. Убедиться, что снимок полный (≥100 тегов). Если нет — повторить.
 * 2. Прочитать СОСТОЯНИЕ кнопки в MCC (ToggleState), а не надеяться
 *    на догадку.
 * 3. Переключить и проверить, что состояние РЕАЛЬНО изменилось.
 * 4. Сравнивать только теги, присутствующие в ОБОИХ снимках.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Фантом на наушники не влияет. Цель — привести 48V в выключенное
 * состояние, потому что в прошлом опыте он остался включённым.
 *
 * Запуск: node src/tools/probe-48v-precise.js
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

/** Снимок с гарантией полноты: если меньше MIN, повторяем. */
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
    if (out.size >= min) return { map: out, size: out.size, attempt: i };
    console.log(`    попытка ${i}: ${out.size} тегов (мало, повторяю)`);
    await sleep(2500);
  }
  return { map: best, size: best.size, attempt: attempts };
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 45000 }).trim();
  } catch (e) { return `ERR:${String(e.message).slice(0, 60)}`; }
};

/** Прочитать состояние кнопки 48V. */
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

/** Нажать кнопку 48V. */
function press48v() {
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
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke()
      Write-Output "OK"
      exit 0
    }
    Write-Output "NO_INVOKE"
    exit 2
  }
}
Write-Output "NOT_FOUND"
`;
  return ps(script);
}

const NOISE = new Set(['11:18']);

/** Только теги, присутствующие в ОБОИХ снимках. */
function diffBoth(a, b) {
  const out = [];
  for (const [k, v] of a) {
    if (NOISE.has(k)) continue;
    if (!b.has(k)) continue;
    if (b.get(k) !== v) out.push({ key: k, from: v, to: b.get(k) });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

async function main() {
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(3000);

  console.log('снимок 1 (MCC закрыт)…');
  const r1 = await fullSnap();
  const s1 = r1.map;
  console.log(`  ${r1.size} тегов (попытка ${r1.attempt}), 0x11:19 = ${s1.get('11:19')}`);

  if (r1.size < 100) {
    console.log('\nСнимок неполный даже после повторов. Стоп:');
    console.log('сравнение будет недостоверным.');
    process.exit(3);
  }

  console.log('\nзапускаю MCC…');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(22000);

  const before = read48v();
  console.log(`  кнопка 48V до нажатия: ${before}`);

  console.log('  нажимаю…');
  const out = press48v();
  console.log(`  ${out}`);
  await sleep(2500);

  const after = read48v();
  console.log(`  кнопка 48V после: ${after}`);

  if (before === after) {
    console.log('\nКнопка НЕ переключилась. Возможно, она заблокирована');
    console.log('(например, 48V нельзя менять в текущем режиме).');
  }

  console.log('\nзакрываю MCC…');
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(4000);

  console.log('\nснимок 2 (MCC закрыт)…');
  const r2 = await fullSnap();
  const s2 = r2.map;
  console.log(`  ${r2.size} тегов (попытка ${r2.attempt}), 0x11:19 = ${s2.get('11:19')}`);

  const d = diffBoth(s1, s2);
  console.log('\n' + '='.repeat(64));
  console.log('ИЗМЕНЕНИЯ (только теги, бывшие в обоих снимках)');
  console.log('='.repeat(64));
  if (!d.length) {
    console.log('  нет изменений');
  } else {
    for (const x of d) console.log(`  0x${x.key}  ${x.from} -> ${x.to}`);
  }

  console.log('\n' + '='.repeat(64));
  console.log('ИТОГ');
  console.log('='.repeat(64));
  console.log(`  кнопка: ${before} -> ${after}`);
  console.log(`  0x11:19: ${s1.get('11:19')} -> ${s2.get('11:19')}`);
  console.log(`  размеры снимков: ${r1.size}, ${r2.size}`);

  const stateChanged = s1.get('11:19') !== s2.get('11:19');
  if (stateChanged) {
    console.log('\n  48V переключился. Тег состояния — 0x11:19.');
    console.log('  Если в разнице есть ЕЩЁ один тег — возможно, это и есть');
    console.log('  адрес управления.');
  } else {
    console.log('\n  0x11:19 не изменился, хотя кнопка нажималась.');
    console.log('  Значит кнопка в этом режиме не влияет на устройство');
    console.log('  (или 48V управляется иначе).');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
