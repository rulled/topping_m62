/**
 * 48V: полная разница «включён / выключен» через MCC.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Прямая запись в 0x11:0x19 не работает, кандидаты в 0x21/0x22 тоже.
 * Но MCC кнопкой включает и выключает 48V — значит какой-то кадр
 * он всё-таки отправляет.
 *
 * ═══ МЕТОД ═══
 *
 * Чтение HID работает параллельно с MCC. Значит:
 *
 *   1. MCC закрыт. Снимок A (48V включён).
 *   2. Открыть MCC, выключить 48V кнопкой, закрыть MCC.
 *   3. Снимок B (48V выключен).
 *   4. Полная разница A против B — не только 0x11:19.
 *
 * Читаем в РАЗНЫХ сессиях и БЕЗ MCC, чтобы не мешал.
 *
 * ═══ ВАЖНО ═══
 *
 * Разница покажет и тег состояния (0x11:19), и, возможно, тег
 * управления, если он приходит в потоке. Если в потоке только
 * состояние — значит управление идёт командой, которую надо
 * ловить захватом (нужен админ).
 *
 * Запуск: node src/tools/probe-48v-toggle.js
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

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 45000 }).trim();
  } catch (e) { return `ERR:${String(e.message).slice(0, 60)}`; }
};

/** Нажать кнопку 48V для IN1 через UIAutomation. */
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
    $tp = $null
    $before = '?'
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
      $before = ([System.Windows.Automation.TogglePattern]$tp).Current.ToggleState
    }
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke()
      Start-Sleep -Milliseconds 1500
      $tp2 = $null
      $after = '?'
      if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp2)) {
        $after = ([System.Windows.Automation.TogglePattern]$tp2).Current.ToggleState
      }
      Write-Output "PRESSED:$before->$after"
      exit 0
    }
  }
}
Write-Output "NOT_FOUND"
`;
  return ps(script);
}

const NOISE = new Set(['11:18']);

function diff(a, b) {
  const out = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    const va = a.get(k);
    const vb = b.get(k);
    if (va === vb) continue;
    if (va === undefined) out.push({ key: k, from: '(нет)', to: vb, kind: 'только во 2-м' });
    else if (vb === undefined) out.push({ key: k, from: va, to: '(нет)', kind: 'только в 1-м' });
    else out.push({ key: k, from: va, to: vb, kind: 'изменился' });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

async function main() {
  // --- состояние 1: сейчас ---
  console.log('снимок 1 (MCC закрыт)…');
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(3000);
  const s1 = await snap();
  console.log(`  ${s1.size} тегов, 0x11:19 = ${s1.get('11:19')}`);

  // --- переключаем через MCC ---
  console.log('\nзапускаю MCC и жму 48V…');
  ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(22000);
  const pressed = press48v();
  console.log(`  ${pressed}`);

  console.log('\nзакрываю MCC…');
  ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
  await sleep(4000);

  // --- состояние 2 ---
  console.log('\nснимок 2 (MCC закрыт)…');
  const s2 = await snap();
  console.log(`  ${s2.size} тегов, 0x11:19 = ${s2.get('11:19')}`);

  // --- разница ---
  const d = diff(s1, s2);
  console.log('\n' + '='.repeat(64));
  console.log('ПОЛНАЯ РАЗНИЦА (48V включён -> выключен)');
  console.log('='.repeat(64));
  if (!d.length) {
    console.log('  отличий нет вообще — странно, 48V должен был измениться');
  } else {
    for (const x of d) {
      console.log(`  0x${x.key}  ${x.from} -> ${x.to}   (${x.kind})`);
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log('РАЗБОР');
  console.log('='.repeat(64));
  const stateChanged = d.some((x) => x.key === '11:19');
  const others = d.filter((x) => x.key !== '11:19');

  console.log(`  0x11:19 изменился: ${stateChanged ? 'да' : 'нет'}`);
  if (others.length) {
    console.log(`  другие теги (${others.length}):`);
    for (const x of others) console.log(`    0x${x.key}: ${x.from} -> ${x.to}`);
  } else {
    console.log('  других изменений нет.');
    console.log('');
    console.log('  ЭТО ЗНАЧИТ: в потоке HID виден ТОЛЬКО результат (0x11:19),');
    console.log('  а сама команда включения идёт отдельным кадром, который');
    console.log('  устройство не отражает в состоянии. Чтобы её поймать,');
    console.log('  нужен захват USBPcap (админ) ИЛИ дизассемблер MCC.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
