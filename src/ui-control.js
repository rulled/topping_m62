/**
 * UI-УПРАВЛЕНИЕ: то, что не пишется через файл и не идёт через HID.
 *
 * Сюда попадают блоки, которые MCC меняет только через свой интерфейс:
 *   - реверб (4 кнопки типа)
 *   - компрессор (dial'ы параметров)
 *
 * Метод: UIAutomation Invoke по координатам + перетаскивание dial
 * с коррекцией DPI (на этой машине 1.75).
 *
 * Проверено 2026-11-07 (research/PIPELINE.md §8.3, WRITE-METHOD.md §10).
 */
import { execFileSync } from 'node:child_process';

import { dumpTree, ps as uiaPs, PRELUDE as UIA_PRELUDE } from './tools/uia.js';

const PS_EXE = 'powershell.exe';

/** Координаты кнопок реверба (логические пиксели UIA). */
export const REVERB_BUTTONS = {
  STUDIO: { x: 1022, y: 1472 },
  LIVE: { x: 1022, y: 1527 },
  HALL: { x: 1022, y: 1581 },
  Bypass: { x: 1022, y: 1636 },
};

/** Соответствие значения HID 0x44:0x0b типу реверба (проверено). */
export const REVERB_TYPE_BY_TAG = {
  1: 'Bypass',
  2: 'STUDIO',
  3: 'LIVE',
  4: 'HALL',
};

/** Координаты dial'ов компрессора (логические). */
export const COMPRESSOR_DIALS = {
  threshold: { x: 756, y: 1302 },
  ratio: { x: 958, y: 1384 },
  attack: { x: 1020, y: 1262 },
  release: { x: 1086, y: 1384 },
  gain: { x: 756, y: 1464 },
};

/**
 * Координаты dial'ов РЕВЕРБА (проверено, NOTES §71).
 *
 * ⚠️ Работают только когда реверб НЕ в Bypass — сначала выберите тип
 * через setReverbType(), потом крутите.
 *
 * Чувствительность (3 щелчка колеса):
 *   dryWet +3, level +2, decay +3, width +0.15
 */
export const REVERB_DIALS = {
  dryWet: { x: 1021, y: 1105, perNotch: 1 },
  level: { x: 1020, y: 1262, perNotch: 0.67 },
  decay: { x: 958, y: 1384, perNotch: 1 },
  width: { x: 1086, y: 1384, perNotch: 0.05 },
};

/**
 * ПОЛНАЯ КАРТА ВСЕХ 12 DIAL'ОВ MCC (проверено, NOTES §75).
 *
 * Это справочник: какие dial'ы что меняют. Для части из них
 * предпочтительнее файл или HID (см. `betterVia`).
 */
export const ALL_DIALS = {
  inputIn1: { x: 164, y: 699, cls: 'DialS1M5', changes: 'Input_IN1.GAIN', betterVia: 'file' },
  inputIn2: { x: 435, y: 699, cls: 'DialS1M5', changes: 'Input_IN2.GAIN', betterVia: 'file' },
  inputAux: { x: 659, y: 699, cls: 'DialS1M6', changes: 'Input_AUX.GAIN', betterVia: 'file' },
  inputBt: { x: 836, y: 699, cls: 'DialS1M6', changes: 'Input_BT.GAIN', betterVia: 'file' },
  inputOtg: { x: 1013, y: 699, cls: 'DialS1M6', changes: 'Input_OTGIN.GAIN', betterVia: 'file' },
  noiseReduction: { x: 493, y: 1105, cls: 'DialS1M5', changes: 'Effect_Integration.NoiseReductionNC1', betterVia: 'file' },
  compThreshold: { x: 756, y: 1302, cls: 'DialS1M1', changes: 'Compressor.Threshold', betterVia: 'ui' },
  compGain: { x: 756, y: 1464, cls: 'DialS1M1', changes: 'Compressor.Gain', betterVia: 'ui' },
  reverbDryWet: { x: 1021, y: 1105, cls: 'DialS1M5', changes: 'DryWet<Type>', betterVia: 'ui' },
  reverbLevel: { x: 1020, y: 1262, cls: 'DialS1M1', changes: 'Reverb<Type>', betterVia: 'ui' },
  reverbDecay: { x: 958, y: 1384, cls: 'DialS1M1', changes: 'Decay<Type>', betterVia: 'ui' },
  reverbWidth: { x: 1086, y: 1384, cls: 'DialS1M1', changes: 'Width<Type>', betterVia: 'ui' },
};

/**
 * Другие кнопки панели FX (проверено диффом INI+HID).
 *
 * Нажатие MUTE-кнопок меняет одноимённые ключи в workspace-файле,
 * поэтому для них предпочтительнее `/api/workspace/apply`.
 */
export const FX_BUTTONS = {
  noiseReduction: { x: 494, y: 1637 },     // NoiseReductionType NC1<->Bypass
  compressorSwitch: { x: 758, y: 1637 },   // Compressor.Switch
  muteFx: { x: 1242, y: 1637 },            // Effect_Integration.MuteFX
  loopbackMute12: { x: 1458, y: 1628 },    // Loopback_LB12.MUTE
  loopbackMute34: { x: 1650, y: 1628 },    // Loopback_LB34.MUTE
  loopbackMute56: { x: 1842, y: 1628 },    // Loopback_LB56.MUTE
  loopbackMute78: { x: 2036, y: 1628 },    // Loopback_LB78.MUTE
  outputHpMute: { x: 2286, y: 1628 },      // Output_HP.MUTE
  outputOtgMute: { x: 2478, y: 1628 },     // Output_OTGOUT.MUTE
};

const PRELUDE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DD2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
}
'@
[DD2]::SetProcessDPIAware() | Out-Null
$dc = [DD2]::GetDC([IntPtr]::Zero)
$script:scale = [DD2]::GetDeviceCaps($dc, 88) / 96.0
[DD2]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null

function Get-MccRoot {
  $p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
`;

function ps(cmd) {
  try {
    return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch (err) {
    // PowerShell вернёт огромный дамп — превращаем в понятную ошибку
    const out = String(err.stdout ?? '') + String(err.stderr ?? '');
    if (out.includes('M Control Center') || out.includes('Get-Process')) {
      throw new Error('M Control Center не запущен — это действие требует его');
    }
    if (out.includes('Item(') || out.includes('outside the bounds')) {
      throw new Error('элемент интерфейса не найден — возможно, открыта другая страница MCC');
    }
    const first = out.split(/\r?\n/).find((l) => l.trim() && !l.includes('at line')) ?? err.message;
    throw new Error(`UI Automation: ${String(first).trim().slice(0, 200)}`);
  }
}

/**
 * Прочитать масштаб DPI.
 *
 * ВАЖНО: PowerShell под русской локалью возвращает "1,75" с ЗАПЯТОЙ.
 * `Number("1,75")` = NaN — из-за этого все dial-операции молча не работали.
 * Заменяем запятую на точку перед разбором.
 */
function readScale() {
  try {
    const raw = ps(PRELUDE + 'Write-Output $script:scale').trim();
    const normalized = raw.replace(',', '.');
    const n = Number(normalized);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ниже fallback */
  }
  return 1.75; // подтверждённое значение на этой машине (DPI 168)
}
export function requireMcc() {
  const out = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count');
  if (Number(out) === 0) {
    throw new Error('M Control Center не запущен — это действие требует его');
  }
  return true;
}

/** Найти MCC-окно или дать понятную ошибку. */
function ensureMcc() {
  const out = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count');
  if (Number(out) === 0) {
    throw new Error('M Control Center не запущен — это действие требует его');
  }
}

/** Нажать кнопку MCC по логическим координатам. */
export function clickAt(lx, ly, tolerance = 40) {
  return ps(PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$best = -1; $bestD = 1e9',
    'for ($i=0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "QPushButton") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Height -le 0) { continue }',
    `  $d = [Math]::Abs($r.X + $r.Width/2 - ${lx}) + [Math]::Abs($r.Y + $r.Height/2 - ${ly})`,
    '  if ($d -lt $bestD) { $bestD = $d; $best = $i }',
    '}',
    `if ($best -lt 0 -or $bestD -gt ${tolerance}) { Write-Output "NOTFOUND"; exit 1 }`,
    '$e = $all.Item($best)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output ("OK idx=" + $best + " d=" + [int]$bestD)',
    '} else { Write-Output "NOPATTERN"; exit 1 }',
  ].join('\n'));
}

/**
 * Найти кнопки реверба ОТНОСИТЕЛЬНО подписей Dry/Wet.
 *
 * Порядок кнопок сверху вниз: STUDIO, LIVE, HALL, Bypass (проверено §62).
 * Координаты зависят от размера окна, поэтому вычисляем на месте.
 *
 * @returns {{STUDIO:{x,y}, LIVE:{x,y}, HALL:{x,y}, Bypass:{x,y}}|null}
 */
export function findReverbButtons() {
  let items;
  try {
    ({ items } = dumpTree());
  } catch {
    return null;
  }

  const dry = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
  if (!dry) return null; // панель эффектов не раскрыта

  const allButtons = items.filter((x) => /QPushButton/.test(x.cls ?? ''));

  // ── ВАРИАНТ 1 (узкое окно, проверено §102) ──
  // Кнопки вертикально под подписью Decay: x ≈ Decay.x + 37,
  // y от Decay.y + 81 с шагом ~31 px. Порядок: STUDIO, LIVE, HALL, Bypass.
  const decay = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Decay');
  if (decay) {
    const col = allButtons.filter((x) => Math.abs(x.lx - (decay.lx + 37)) < 25
      && x.ly > decay.ly + 40 && x.ly < decay.ly + 250)
      .sort((a, b) => a.ly - b.ly);
    if (col.length >= 4) {
      return {
        STUDIO: { x: col[0].lx, y: col[0].ly },
        LIVE: { x: col[1].lx, y: col[1].ly },
        HALL: { x: col[2].lx, y: col[2].ly },
        Bypass: { x: col[3].lx, y: col[3].ly },
        layout: 'vertical-under-decay',
      };
    }
  }

  // ── ВАРИАНТ 2 (широкое окно, проверено §28/§62) ──
  // Кнопки вертикально левее Dry, ниже неё. Порядок тот же.
  const nearDry = allButtons.filter((x) => x.lx < dry.lx - 40 && x.lx > dry.lx - 260
    && x.ly > dry.ly && x.ly < dry.ly + 700)
    .sort((a, b) => a.ly - b.ly);
  if (nearDry.length >= 4) {
    return {
      STUDIO: { x: nearDry[0].lx, y: nearDry[0].ly },
      LIVE: { x: nearDry[1].lx, y: nearDry[1].ly },
      HALL: { x: nearDry[2].lx, y: nearDry[2].ly },
      Bypass: { x: nearDry[3].lx, y: nearDry[3].ly },
      layout: 'left-of-dry',
    };
  }

  return null;
}

/**
 * Переключить тип реверба.
 *
 * ВАЖНО (проверено 2026-11-07): кнопки реверба появляются только когда
 * панель эффектов раскрыта (кнопка MORE), и их координаты зависят от
 * размера окна. Поэтому: раскрываем панель, ищем кнопки относительно
 * подписи Dry, кликаем.
 *
 * @param {'STUDIO'|'LIVE'|'HALL'|'Bypass'} type
 */
export function setReverbType(type) {
  if (!REVERB_TYPE_BY_TAG || !Object.values(REVERB_TYPE_BY_TAG).includes(type)) {
    throw new Error(`неизвестный тип реверба: ${type}; допустимо: ${Object.values(REVERB_TYPE_BY_TAG).join(', ')}`);
  }
  ensureMcc();
  ensureReverbPanelOpen();

  const found = findReverbButtons();
  if (!found) {
    throw new Error('кнопки реверба не найдены — панель эффектов не раскрылась');
  }

  const b = found[type];
  return clickAt(b.x, b.y);
}

/**
 * Раскрыть панель эффектов (кнопка MORE), если она закрыта.
 * Признак закрытой панели: нет подписи "Dry" рядом с ревербом.
 */
export function ensureReverbPanelOpen() {
  ensureMcc();
  const hasDry = () => {
    try {
      const { items } = dumpTree();
      return items.some((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
    } catch {
      return false;
    }
  };

  if (hasDry()) return { opened: false, note: 'панель уже открыта' };

  // ищем кнопку MORE по имени
  const RAW = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.Name -eq 'MORE') {
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke()
      Write-Output ("MORE_CLICKED idx=" + $i)
      exit 0
    }
  }
}
Write-Output "MORE_NOT_FOUND"
`;
  const out = ps(RAW);
  return { opened: out.includes('MORE_CLICKED'), result: out };
}

/**
 * Потянуть dial на заданное число шагов.
 * Каждые ~4 физических пикселя ≈ 1 единица значения.
 *
 * @param {{x:number,y:number}} dial логические координаты
 * @param {number} steps положительное — вниз (уменьшение), отрицательное — вверх
 */
export function dragDial(dial, steps) {
  ensureMcc();
  const scale = readScale();
  const px = Math.round(dial.x / scale);
  const py = Math.round(dial.y / scale);
  const dyPx = Math.round(steps * 4);

  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSX {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSX]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 300
[MSX]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 200
$steps = 12
for ($i=1; $i -le $steps; $i++) {
  [MSX]::SetCursorPos(${px}, ${py} + [int]((${dyPx} / $steps) * $i))
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 200
[MSX]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "dragged"
`;
  return ps(SCRIPT);
}

/** Проверить, запущен ли MCC. */
export function mccRunning() {
  const out = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count');
  return Number(out) > 0;
}

/**
 * Аудиопараметры драйвера: sample rate и buffer size.
 *
 * Найдено в research/NOTES.md §63 — это комбобоксы в шапке MCC.
 * В HID их нет, в workspace-файле тоже. Только через UI.
 *
 * Проверено 2026-11-07:
 *   sample rate: 44100, 48000
 *   buffer size: 8, 16, 32, 64, 128, 256, 512, 1024, 2048
 */
export const AUDIO_OPTIONS = {
  sampleRate: [44100, 48000],
  bufferSize: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
};

/**
 * Нажать элемент MCC ПО ИМЕНИ — надёжнее, чем по координатам.
 *
 * Найдено (NOTES §69): кнопки пресетов и сцен — это `QToolButton`
 * с именами, а не безымянные `QPushButton` по координатам.
 *
 * Доступные имена:
 *   'Load preset1', 'Load preset2', 'Save preset1', 'Save preset2',
 *   'Chat', 'Vocal'
 *
 * Координаты зависят от разрешения и DPI, имена — нет. Предпочитайте этот
 * метод везде, где у элемента есть имя.
 *
 * @param {string} name точное имя элемента
 */
export function clickByName(name) {
  ensureMcc();
  const RAW = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = $false
for ($i = 0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.Name -eq '` + name.replace(/'/g, "''") + String.raw`') {
    $ip = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) {
      ([System.Windows.Automation.InvokePattern]$ip).Invoke()
      Write-Output ("OK idx=" + $i)
      $found = $true
      break
    }
  }
}
if (-not $found) { Write-Output "NOTFOUND"; exit 1 }
`;
  const out = ps(RAW);
  if (out.startsWith('NOTFOUND')) {
    throw new Error(`элемент "${name}" не найден в MCC`);
  }
  return out;
}

/** Имена всех кнопок, нажимаемых по имени. */
export const NAMED_BUTTONS = [
  'Load preset1',
  'Load preset2',
  'Save preset1',
  'Save preset2',
  'Chat',
  'Vocal',
];

/**
 * Крутить dial колесом мыши.
 *
 * @param {{x:number,y:number}} dial логические координаты
 * @param {number} notches сколько щелчков (положительное — вверх/больше)
 */
export function wheelDial(dial, notches) {
  ensureMcc();
  const scale = readScale();
  const px = Math.round(dial.x / scale);
  const py = Math.round(dial.y / scale);
  const n = Math.abs(Math.round(notches));
  const dir = notches >= 0 ? 120 : 0x100000000 - 120;

  const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSWh {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSWh]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 200
for ($i=0; $i -lt ${n}; $i++) {
  [MSWh]::mouse_event(0x0800, 0, 0, ${dir}, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 50
}
Write-Output "wheeled"
`;
  return ps(SCRIPT);
}

/**
 * Изменить параметр реверба на заданное число единиц.
 *
 * ⚠️ Требует, чтобы реверб был НЕ в Bypass (иначе dial'ы не реагируют).
 *
 * @param {'dryWet'|'level'|'decay'|'width'} param
 * @param {number} delta приращение (может быть отрицательным)
 */
export function nudgeReverb(param, delta) {
  const d = REVERB_DIALS[param];
  if (!d) throw new Error(`неизвестный параметр реверба: ${param}; допустимо: ${Object.keys(REVERB_DIALS).join(', ')}`);
  const notches = Math.round(delta / d.perNotch);
  if (notches === 0) return { param, delta, notches: 0, note: 'слишком мало для движения' };
  const out = wheelDial(d, notches);
  return { param, delta, notches, result: out };
}

/** Все доступные кнопки/действия. */
export function describeUiControls() {
  return {
    reverbTypes: Object.keys(REVERB_BUTTONS),
    reverbButtons: REVERB_BUTTONS,
    reverbTypeByTag: REVERB_TYPE_BY_TAG,
    compressorDials: COMPRESSOR_DIALS,
    reverbDials: REVERB_DIALS,
    allDials: ALL_DIALS,
    fxButtons: FX_BUTTONS,
    audioOptions: AUDIO_OPTIONS,
    namedButtons: NAMED_BUTTONS,
    compressorWritable: {
      viaDial: ['threshold', 'gain'],
      onlyViaPreset: ['ratio', 'attack', 'release', 'mix'],
      note: 'Ratio/Attack/Release/Mix не имеют прямой записи — только через Load preset',
    },
    caveats: [
      'требуется запущенный M Control Center',
      'координаты зависят от разрешения и DPI (сняты при 2560x1080, DPI 168)',
      'порядок кнопок реверба сверху вниз: STUDIO, LIVE, HALL, Bypass (проверено §62)',
      'MUTE-кнопки loopback и outputs меняют ключи в файле — для них лучше /api/workspace/apply',
      'НЕ использовать UIAutomation для смены workspace — это ломает UI MCC (проверено, NOTES §61)',
    ],
  };
}
