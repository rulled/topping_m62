/**
 * РЕШАЮЩИЙ ОПЫТ: карта реверба через движение контрола в MCC.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `map-reverb-tags.js` нашёл четыре совпадения по значению:
 *
 *   0x44:08 = 30  ->  DryWetBypass = 30
 *   0x44:09 =  4  ->  ReverbBypass = 4
 *   0x44:0a = 11  ->  DecayBypass  = 11
 *   0x44:0f = 70  ->  WidthBypass  = 0.7  (x100)
 *
 * Совпадение по значению — гипотеза, а не доказательство. Тем более
 * что 0x44:09 раньше числился как «код NC» со значением 1.
 *
 * ═══ МЕТОД ═══
 *
 * Тот же, которым расшифрован NC (docs/EFFECTS.md):
 *
 *   1. MCC закрыт. Снимок 0x44.
 *   2. Открыть MCC, сдвинуть ОДИН контрол реверба, закрыть MCC.
 *   3. Снимок 0x44 заново.
 *   4. Тег, изменившийся ровно на столько же, — это и есть контрол.
 *
 * ═══ ЧТО ДВИГАЕМ ═══
 *
 * Порядок от безопасного к рискованному. Наушники отключены, так что
 * звука не будет. Но всё равно каждый шаг откатывается.
 *
 *   1. Dry/Wet  (0x44:08 по гипотезе)
 *   2. Room     (0x44:09)
 *   3. Decay    (0x44:0a)
 *   4. Width    (0x44:0f)
 *
 * Запуск: node src/tools/prove-reverb-map.js [--live]
 *        без --live только снимает и печатает, ничего не двигая
 */

import HID from 'node-hid';
import { readFileSync } from 'node:fs';
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

const LIVE = process.argv.includes('--live');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function freshSnapshot(ms = 16000) {
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
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      if (f.target === 0x44) out.set(hex2(f.prop), f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch { /* ok */ }
  return out;
}

function activeIni() {
  const key = String.raw`HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62`;
  let name = 'main';
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).M62_Live_Workspace`],
    { encoding: 'utf8', timeout: 15000 }).trim();
    if (out) name = out;
  } catch { /* main */ }
  return String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_${name}.ini`;
}

function readFx() {
  const out = {};
  let cur = null;
  const path = activeIni();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) { cur = m[1]; continue; }
    if (cur !== 'Effect_Integration' || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** Сравнивает два снимка и печатает изменившиеся теги. */
function diff(label, before, after) {
  const changed = [];
  for (const [k, v] of after) {
    const b = before.get(k);
    if (b !== undefined && b !== v) changed.push({ prop: k, from: b, to: v, delta: v - b });
  }
  if (!changed.length) {
    console.log(`  ${label}: НИЧЕГО не изменилось`);
  } else {
    console.log(`  ${label}: изменились ${changed.length} тег(ов):`);
    for (const c of changed) {
      console.log(`    0x44:${c.prop}  ${c.from} -> ${c.to}  (дельта ${c.delta > 0 ? '+' : ''}${c.delta})`);
    }
  }
  return changed;
}

/** Двигает дил реверба в MCC через стрелки. */
function nudgeReverbDial(which, notches) {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$root = $null
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  if ($w.Current.ClassName -eq 'MainWindow_M62') { $root = $w; break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

# Все Dial в дереве
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)
$dials = @()
foreach ($e in $all) {
  if ($e.Current.ClassName -match 'Dial') { $dials += $e }
}
Write-Output ("DIALS:" + $dials.Count)
foreach ($d in $dials) {
  Write-Output ("  " + $d.Current.ClassName + " @" + [int]$d.Current.BoundingRectangle.X + "," + [int]$d.Current.BoundingRectangle.Y + " name=" + $d.Current.Name)
}
`;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script],
      { encoding: 'utf8', timeout: 40000 });
    console.log(out.trim());
  } catch (err) {
    console.log(`  ошибка UI: ${String(err.message).slice(0, 120)}`);
  }
}

async function main() {
  const fx = readFx();
  const type = fx.ReverbType ?? '?';
  console.log(`ReverbType = ${type}`);
  const fileVals = {
    dryWet: fx[`DryWet${type}`],
    room: fx[`Reverb${type}`],
    decay: fx[`Decay${type}`],
    width: fx[`Width${type}`],
  };
  console.log(`из файла: DryWet=${fileVals.dryWet} Room=${fileVals.room} Decay=${fileVals.decay} Width=${fileVals.width}`);

  console.log('\nснимок «до»…');
  const before = await freshSnapshot();
  console.log('  0x44:', [...before.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

  if (!LIVE) {
    console.log('\n(режим без движения: добавь --live чтобы проверить карту)');
    return;
  }

  console.log('\nзапускаю MCC…');
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'],
  { timeout: 20000 });
  await sleep(20000);

  nudgeReverbDial('dryWet', 3);

  console.log('\nзакрываю MCC…');
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Stop-Process -Force'],
  { timeout: 20000 });
  await sleep(4000);

  console.log('снимок «после»…');
  const after = await freshSnapshot();
  console.log('  0x44:', [...after.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

  console.log('');
  const changed = diff('итог', before, after);
  if (changed.length) {
    console.log('\nИзменение показывает, какой тег привязан к контролу.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
