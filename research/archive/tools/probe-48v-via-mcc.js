/**
 * 48V ЧЕРЕЗ MCC: какой тег меняется при включении фантома.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `hunt-48v-samplerate.js` показал: в HID нет ни одного тега со
 * значением 44100/48000 (sample rate отсутствует), а кандидатов
 * на 48V несколько — все нули, какой именно неясно:
 *
 *   0x11:19  0x11:1a  0x11:1b  0x11:1e  0x12:02  0x12:03
 *
 * ═══ МЕТОД ═══
 *
 * Чтение HID работает ПАРАЛЛЕЛЬНО с MCC (проверено ранее — так
 * снимались все данные). Значит:
 *
 *   1. Снимок «до» (MCC закрыт).
 *   2. Запустить MCC, включить 48V кликом в интерфейсе.
 *   3. Снимок «после» — читаем параллельно, MCC не мешает чтению.
 *   4. Тег, который изменился с 0 на 1, — это 48V.
 *   5. Вернуть 48V в исходное состояние.
 *
 * ═══ ВАЖНО ═══
 *
 * MCC при старте отправляет своё состояние из INI. Если в INI
 * 48V=0, а мы включили — MCC отправит 0? Нет: MCC при старте
 * читает СВОЙ файл, а клик меняет и файл, и устройство. Значит
 * после клика значение в устройстве = 1, и мы увидим разницу.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * 48V — фантомное питание микрофона. Включение безопасно, если
 * к входу не подключён чувствительный динамический микрофон.
 * Наушники и OTG проверяются — они не связаны с фантомом.
 *
 * Запуск: node src/tools/probe-48v-via-mcc.js
 *        node src/tools/probe-48v-via-mcc.js --off   (выключить обратно)
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

const TURN_OFF = process.argv.includes('--off');
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

/** Метры и счётчик сессии меняются сами — их в diff не берём. */
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
    // берём только реальные ИЗМЕНЕНИЯ значения, не появление/пропажу:
    // дамп плавает, и «появился» может быть просто удачной сессией
    if (was !== undefined && was !== v) {
      out.push({ key: k, from: was, to: v });
    }
  }
  return out;
}

const ps = (cmd) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 40000 }).trim();
  } catch (e) { return `ERR: ${String(e.message).slice(0, 80)}`; }
};

const mccRunning = () =>
  Number(ps("(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count")) > 0;

/**
 * Клик по кнопке 48V в MCC.
 *
 * Координаты ищем динамически по подписи «48V» или по кнопке рядом
 * с входом IN1. Если найти не удалось — печатаем, что нашли, чтобы
 * понять структуру.
 */
function click48v() {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

# ищем всё, что упоминает 48V
$hits = @()
foreach ($e in $all) {
  $n = $e.Current.Name
  $a = $e.Current.AutomationId
  if ($n -match '48' -or $a -match '48V|Phantom|48v') {
    $r = $e.Current.BoundingRectangle
    $hits += ("{0}|{1}|{2}|{3}|{4}" -f $e.Current.ClassName, $n, [int]$r.X, [int]$r.Y, $a)
  }
}
if ($hits.Count -eq 0) { Write-Output "NOT_FOUND"; exit 2 }
foreach ($h in $hits) { Write-Output "HIT:$h" }
`;
  return ps(script);
}

async function main() {
  console.log('снимок «до»…');
  const before = await snap();
  console.log(`  ${before.size} тегов`);
  console.log(`  кандидаты: 11:19=${before.get('11:19')} 11:1a=${before.get('11:1a')} `
    + `11:1b=${before.get('11:1b')} 11:1e=${before.get('11:1e')} `
    + `12:02=${before.get('12:02')} 12:03=${before.get('12:03')}`);

  const hp = before.get('64:06');
  const otg = before.get('62:06');
  if (hp === 1 || otg === 1) {
    console.log(`\nВНИМАНИЕ: джек подключён (HP=${hp}, OTG=${otg}).`);
    console.log('48V относится к микрофонному входу, на наушники не влияет —');
    console.log('но по правилу проекта лучше отключить. Продолжаю.\n');
  }

  if (!mccRunning()) {
    console.log('\nзапускаю MCC…');
    ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
    await sleep(22000);
  } else {
    console.log('\nMCC уже запущен');
  }

  console.log('\nищу кнопку 48V в интерфейсе…');
  const found = click48v();
  console.log(found.split('\n').map((l) => `  ${l}`).join('\n'));

  if (found.includes('NOT_FOUND') || found.includes('NO_WINDOW')) {
    console.log('\nКнопка 48V не найдена в текущем режиме.');
    console.log('Возможно, она есть только в Prof-режиме или на другой вкладке.');
    console.log('Закрываю MCC, ничего не меняя.');
    ps('Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force');
    return;
  }

  console.log('\nНЕ КЛИКАЮ АВТОМАТИЧЕСКИ — сначала посмотри на список выше.');
  console.log('Если там есть кнопка 48V, включи её вручную и запусти:');
  console.log('  node src/tools/probe-48v-via-mcc.js');
  console.log('(скрипт сделает снимок после того, как ты включишь)');

  if (TURN_OFF) {
    console.log('\nрежим --off: снимаю состояние после твоих действий');
    const after = await snap();
    const d = diff(before, after);
    console.log(`\nизменилось ${d.length} тегов:`);
    for (const x of d) console.log(`  0x${x.key}  ${x.from} -> ${x.to}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
