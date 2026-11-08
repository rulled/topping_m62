/**
 * EQ ЧЕРЕЗ UI — ПОЛНОЕ УПРАВЛЕНИЕ ЭКВАЛАЙЗЕРОМ MCC.
 *
 * ═══ ГЛАВНОЕ ОТКРЫТИЕ (2026-11-07, раунд 53) ═══
 *
 * Раньше считалось (NOTES §97), что Gain/Freq/Q меняются ТОЛЬКО мышью,
 * потому что у дилов нет RangeValue и ValuePattern.SetValue бесполезен.
 * Это верно, НО был упущен третий путь: **КЛАВИАТУРА**.
 *
 * Если вызвать AutomationElement.SetFocus() на диле и послать стрелки,
 * значение меняется, и MCC записывает его в workspace-файл.
 *
 * Проверено (eq-keyboard-calibrate.js, eq-file-timing.js):
 *   - SetFocus + SendKeys("{UP}") работает на всех трёх дилах
 *   - запись файла происходит с задержкой ~650-700 мс
 *   - Gain: ±1 дБ за нажатие, ЛИНЕЙНО
 *   - Freq: нелинейно (логарифмическая шкала)
 *   - Q:    нелинейно, диапазон ШИРЕ заявленного (наблюдали 0.2441 при
 *           «минимуме 0.707» — прежняя оценка неверна)
 *
 * ═══ ЧТО ГДЕ ХРАНИТСЯ ═══
 *   Switch       — TogglePattern кнопки EQ (файл врёт: всегда пишет 1)
 *   тип фильтра  — ValuePattern комбобокса (UIA Select не применяет!)
 *   Gain/Freq/Q  — workspace-файл, меняется клавиатурой на диле
 *
 * ═══ СТРУКТУРА ОКНА EQ (проверено eq-children.js) ═══
 *   EqualizerBase (окно)
 *     EqualizerPanelS1M1
 *       EqualizerControllerS1M1
 *         4 x EqWidgetIem  (по одной на полосу)
 *           QLabel        "1".."4"
 *           ComboBoxS1M3  тип фильтра        (714/796/878/960, y=508)
 *           DialS1M5      Gain                (y=564)
 *           DialS1M5      Freq                (y=642)
 *           DialS1M5      Q                   (y=720)
 *           QCheckBox     вкл/выкл полосы     (y=766) — TogglePattern
 *
 * Окно открывается ДВОЙНЫМ КЛИКОМ по кнопке EQ в колонке входа.
 */
import { ps, PRELUDE, dumpTree } from './tools/uia.js';
import { freqPresses, freqToStep, qPresses, qSnap } from './eq-scales.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

/** Задержка записи workspace-файла после нажатия (измерено ~660 мс). */
export const FILE_SETTLE_MS = 900;

/**
 * Геометрия окна EQ.
 *
 * ВАЖНО: координаты ЗАВИСЯТ ОТ РАЗРЕШЕНИЯ и перепроверены 2026-11-07
 * при 1920x1080 / DPI 96 (RDP-сессия). Прежние значения (714/796/878/960)
 * снимались при 2560x1080 / DPI 168 и НЕВЕРНЫ для текущего разрешения.
 *
 * Реальные координаты берутся НЕ отсюда, а из dialIndexMap() — она ищет
 * элементы по классу и AutomationId. Этот объект нужен только для
 * справки фронту.
 */
export const EQ_LAYOUT = {
  measuredAt: { screen: '1920x1080', dpi: 96, scale: 1 },
  bands: [849, 931, 1013, 1095],
  rows: { type: 508, gain: 564, freq: 642, q: 720, enable: 766 },
  ranges: {
    gain: { measured: [-12, 12], unit: 'dB', step: 1, kind: 'linear' },
    freq: { measured: [20, 20000], unit: 'Hz', step: 'log', kind: 'logarithmic' },
    q: { measured: [0.1, 15], unit: '', step: 'table', kind: 'table' },
  },
  filterTypes: ['peaking', 'lowpass', 'highpass', 'lowshelf', 'highshelf'],
};

/** Проверить, что MCC запущен. */
function ensureMcc() {
  const cnt = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count').trim();
  if (Number(cnt) === 0) throw new Error('M Control Center не запущен — EQ-управление требует его');
}

/** Открыто ли окно EQ. */
export function isEqWindowOpen() {
  try {
    return dumpTree().items.some((x) => /EqualizerBase|EqualizerPanel/.test(x.cls ?? ''));
  } catch {
    return false;
  }
}

/** Координаты кнопки EQ входа (та, что имеет TogglePattern). */
function findEqButton(which = 'IN1') {
  const { items } = dumpTree();
  const cols = items.filter((x) => /QPushButton/.test(x.cls ?? '')
    && x.lx > 100 && x.lx < 340 && x.ly > 100 && x.ly < 400)
    .sort((a, b) => a.lx - b.lx || a.ly - b.ly);

  const groups = [];
  for (const b of cols) {
    let g = groups.find((c) => Math.abs(c.x - b.lx) < 25);
    if (!g) { g = { x: b.lx, items: [] }; groups.push(g); }
    g.items.push(b);
  }
  groups.sort((a, b) => a.x - b.x);
  const target = groups.find((g) => {
    const eqY = g.items.find((b) => Math.abs(b.ly - 270) < 20);
    return Boolean(eqY) && (which === 'IN2' ? g.x > 200 : g.x < 200);
  });
  if (target) return target.items.find((b) => Math.abs(b.ly - 270) < 20) ?? null;
  const inputCols = groups.filter((g) => g.items.length >= 4);
  const col = inputCols[which === 'IN2' ? 1 : 0];
  if (!col) return null;
  return col.items[col.items.length - 2] ?? col.items[5] ?? null;
}

/** Прочитать ToggleState элемента по индексу. */
function toggleState(idx) {
  return ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { Write-Output ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState } else { Write-Output "NO_TOGGLE" }
`);
}

/**
 * Прочитать состояние EQ (Switch). Истина — только UI.
 * @param {'IN1'|'IN2'} which
 */
export function readEqSwitch(which = 'IN1') {
  ensureMcc();
  const btn = findEqButton(which);
  if (!btn) throw new Error(`кнопка EQ для ${which} не найдена`);
  const st = toggleState(btn.i);
  return { input: which, enabled: st === 'On', raw: st, button: [btn.lx, btn.ly] };
}

/**
 * Переключить EQ через TogglePattern (без движения курсора).
 * @param {'IN1'|'IN2'} which
 * @param {boolean} [want]
 */
export function setEqSwitch(which = 'IN1', want) {
  ensureMcc();
  const btn = findEqButton(which);
  if (!btn) throw new Error(`кнопка EQ для ${which} не найдена`);

  const cur = toggleState(btn.i);
  const isOn = cur === 'On';
  const target = want === undefined ? !isOn : Boolean(want);
  if (isOn === target) return { input: which, enabled: target, changed: false, raw: cur };

  ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${btn.i})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {
  ([System.Windows.Automation.TogglePattern]$p).Toggle()
  Write-Output "TOGGLED"
} else { Write-Output "NO_TOGGLE" }
`);

  return { input: which, enabled: target, changed: true };
}

/**
 * Карта индексов дилов: { band: { gain, freq, q } } для окна EQ указанного входа.
 * @param {'IN1'|'IN2'} which
 */
export function dialIndexMap(which = 'IN1') {
  const prefix = `QApplication.EQ_${which}`;
  const list = JSON.parse(ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'DialS1M5') { continue }
  $aid = $e.Current.AutomationId
  if ($aid -notlike '*EqWidgetIem.DialS1M5') { continue }
  $r = $e.Current.BoundingRectangle
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); aid=$aid }
}
$out | ConvertTo-Json -Compress -Depth 3
`).replace(/\r?\n/g, ''));
  let arr = Array.isArray(list) ? list : [list];
  arr = arr.filter((d) => (d.aid ?? '').startsWith(prefix) || !which);
  if (!arr.length) return {};

  const xs = [...new Set(arr.map((d) => d.x))].sort((a, b) => a - b);
  const map = {};
  for (const x of xs) {
    const band = xs.indexOf(x) + 1;
    map[band] = {};
    for (const [param, y] of Object.entries({ gain: 564, freq: 642, q: 720 })) {
      const hit = arr.find((d) => d.x === x && Math.abs(d.y - y) < 12);
      if (hit) map[band][param] = hit.i;
    }
  }
  return map;
}

/** Индексы чекбоксов включения полос + их состояние. */
export function bandEnableState(which = 'IN1') {
  const raw = ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'QCheckBox') { continue }
  if ($e.Current.AutomationId -notlike '*EqWidgetIem*') { continue }
  $r = $e.Current.BoundingRectangle
  $pat = $null
  $tg = 'NO_TOGGLE'
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
    $tg = ([System.Windows.Automation.TogglePattern]$pat).Current.ToggleState.ToString()
  }
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2); toggle=$tg }
}
$out | ConvertTo-Json -Compress -Depth 3
`);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .sort((a, b) => a.x - b.x)
    .map((b, i) => ({ band: i + 1, index: b.i, enabled: b.toggle === 'On', raw: b.toggle, x: b.x, y: b.y }));
}

/**
 * Нажать клавишу на диле N раз (с SetFocus).
 * @param {number} idx индекс AutomationElement
 * @param {'UP'|'DOWN'} key
 * @param {number} times
 */
export function pressDial(idx, key, times = 1) {
  ensureMcc();
  return ps(String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$tops = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$root = $null
for ($i = 0; $i -lt $tops.Count; $i++) {
  if ($tops.Item($i).Current.ClassName -eq "MainWindow_M62") { $root = $tops.Item($i); break }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$e.SetFocus()
Start-Sleep -Milliseconds 200
for ($k = 0; $k -lt ${times}; $k++) {
  [System.Windows.Forms.SendKeys]::SendWait("{${key}}")
  Start-Sleep -Milliseconds 110
}
Write-Output "pressed"
`).trim();
}

/**
 * Изменить параметр полосы на delta (клавиатурой).
 *
 * Для gain шаг = 1 дБ -> |delta| = число нажатий.
 * Для freq/Q delta трактуется как ЧИСЛО НАЖАТИЙ (шкалы нелинейны;
 *   для перевода значения в нажатия используйте setEqParamTo).
 *
 * @param {'IN1'|'IN2'} which
 * @param {number} band 1..4
 * @param {'gain'|'freq'|'q'} param
 * @param {number} delta
 */
export function nudgeEqParam(which, band, param, delta) {
  if (!isEqWindowOpen()) throw new Error('окно EQ не открыто');
  const map = dialIndexMap(which);
  const idx = map[band]?.[param];
  if (idx === undefined) throw new Error(`дил ${param} полосы ${band} (${which}) не найден`);

  const presses = Math.round(Math.abs(delta));
  if (presses === 0) return { changed: false, reason: 'delta слишком мал' };

  const key = delta >= 0 ? 'UP' : 'DOWN';
  pressDial(idx, key, presses);
  return { band, param, presses, key, settleMs: FILE_SETTLE_MS };
}

/**
 * ЗАДАТЬ АБСОЛЮТНОЕ значение параметра полосы.
 *
 * Переводит целевое значение в число нажатий по измеренной шкале
 * (eq-scales.js) и крутит дил клавиатурой.
 *
 * @param {'IN1'|'IN2'} which
 * @param {number} band 1..4
 * @param {'gain'|'freq'|'q'} param
 * @param {number} target целевое значение
 * @param {{type:number,gain:number,freq:number,q:number}} current текущее (из файла)
 */
export function setEqParamTo(which, band, param, target, current) {
  if (!isEqWindowOpen()) throw new Error('окно EQ не открыто');
  if (!current) throw new Error('нужно текущее состояние полосы (нет данных из файла)');

  let presses;
  let reachable = target;

  if (param === 'gain') {
    presses = Math.round(target - current.gain);
  } else if (param === 'freq') {
    presses = freqPresses(current.freq, target);
    reachable = freqToStep(target);
  } else if (param === 'q') {
    presses = qPresses(current.q, target);
    reachable = qSnap(target);
  } else {
    throw new Error(`неизвестный параметр: ${param}`);
  }

  if (presses === 0) {
    return { band, param, changed: false, presses: 0, reachable, reason: 'уже на целевом шаге' };
  }

  const map = dialIndexMap(which);
  const idx = map[band]?.[param];
  if (idx === undefined) throw new Error(`дил ${param} полосы ${band} не найден`);

  const key = presses > 0 ? 'UP' : 'DOWN';
  pressDial(idx, key, Math.abs(presses));
  return {
    changed: true,
    band, param, presses, key, reachable, settleMs: FILE_SETTLE_MS,
    note: param === 'gain' ? undefined : 'целевое значение округлено до ближайшего шага шкалы',
  };
}

/** Прочитать типы фильтров всех 4 полос. */
export function readEqTypes(which = 'IN1') {
  ensureMcc();
  if (!isEqWindowOpen()) throw new Error('окно EQ не открыто');

  const raw = ui(String.raw`
$root = Get-MccRoot
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -ne 'ComboBoxS1M3') { continue }
  if ($e.Current.AutomationId -notlike '*EqWidgetIem.ComboBoxS1M3') { continue }
  $r = $e.Current.BoundingRectangle
  $p = $null
  $v = ''
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
    $v = ([System.Windows.Automation.ValuePattern]$p).Current.Value
  }
  $out += [pscustomobject]@{ i=$i; x=[int]($r.X+$r.Width/2); val=$v }
}
$out | ConvertTo-Json -Compress -Depth 3
`);
  if (!raw) return [];
  const arr = JSON.parse(raw);
  return (Array.isArray(arr) ? arr : [arr])
    .sort((a, b) => a.x - b.x)
    .map((c, i) => ({ band: i + 1, type: c.val, index: c.i, x: c.x }));
}

/**
 * Открыть окно EQ двойным кликом по кнопке входа.
 * @param {'IN1'|'IN2'} which
 */
export async function openEqWindow(which = 'IN1') {
  ensureMcc();
  if (isEqWindowOpen()) return { opened: true, alreadyOpen: true };
  const btn = findEqButton(which);
  if (!btn) throw new Error(`кнопка EQ ${which} не найдена`);

  const scaleRaw = ps(PRELUDE + 'Write-Output $script:scale').trim().replace(',', '.');
  const scale = Number(scaleRaw) || 1.75;
  const px = Math.round(btn.lx / scale);
  const py = Math.round(btn.ly / scale);

  ps(String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MSEqOpen {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@
[MSEqOpen]::SetCursorPos(${px}, ${py})
Start-Sleep -Milliseconds 250
[MSEqOpen]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSEqOpen]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 90
[MSEqOpen]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[MSEqOpen]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
`);

  await sleep(2200);
  return { opened: isEqWindowOpen(), button: [btn.lx, btn.ly] };
}

/** Описание возможностей EQ для фронта (сухие факты). */
export function describeEq() {
  return {
    layout: EQ_LAYOUT,
    storage: {
      switch: 'UI TogglePattern кнопки EQ — единственный надёжный источник',
      filterType: 'UI ValuePattern комбобокса в окне EQ',
      gainFreqQ: 'workspace-файл, ключи Eq%401..Eq%404 секции EQ_IN1/EQ_IN2',
    },
    writePaths: {
      switch: 'TogglePattern.Toggle() — без движения курсора',
      gainFreqQ: 'AutomationElement.SetFocus() + SendKeys стрелок — ЕДИНСТВЕННЫЙ рабочий путь',
      filterType: 'реальный клик мышью (UIA Select() возвращает успех, но не применяет)',
      bandEnable: 'TogglePattern на QCheckBox полосы',
    },
    deadEnds: [
      'ValuePattern.SetValue на дилах возвращает успех, но значение пустое и не меняется',
      'RangeValuePattern на дилах EQ отсутствует',
      'InvokePattern на дилах не меняет значение',
      'UIA SelectionItemPattern.Select() на комбобоксе типа не применяет выбор',
      'прямая запись HID в EQ не принимается устройством',
    ],
    timing: {
      fileWriteDelayMs: 660,
      recommendedSettleMs: FILE_SETTLE_MS,
      note: 'файл обновляется с задержкой ~660 мс — читать раньше бессмысленно',
    },
    limitations: [
      'требуется запущенный M Control Center',
      'EQ Switch в файле всегда 1 — не использовать как индикатор',
      'координаты сняты при 2560x1080, DPI 168 (масштаб 1.75)',
      'диапазоны Gain/Freq/Q в файле документации MCC и в реальности расходятся — см. layout.ranges.measured',
    ],
  };
}

// ---------- CLI ----------
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const cmd = process.argv[2] ?? 'show';
  try {
    if (cmd === 'show') {
      console.log('окно EQ:', isEqWindowOpen() ? 'открыто' : 'закрыто');
      console.log('EQ IN1:', JSON.stringify(readEqSwitch('IN1')));
      console.log('EQ IN2:', JSON.stringify(readEqSwitch('IN2')));
      if (isEqWindowOpen()) {
        console.log('типы фильтров:', JSON.stringify(readEqTypes('IN1')));
        console.log('дилы:', JSON.stringify(dialIndexMap('IN1')));
        console.log('полосы вкл:', JSON.stringify(bandEnableState('IN1')));
      }
    } else if (cmd === 'open') {
      console.log(JSON.stringify(await openEqWindow(process.argv[3] ?? 'IN1')));
    } else if (cmd === 'on' || cmd === 'off') {
      const which = process.argv[3] ?? 'IN1';
      console.log(JSON.stringify(setEqSwitch(which, cmd === 'on')));
      await sleep(1500);
      console.log('проверка:', JSON.stringify(readEqSwitch(which)));
    } else if (cmd === 'nudge') {
      const [which, band, param, delta] = process.argv.slice(3);
      console.log(JSON.stringify(nudgeEqParam(which ?? 'IN1', Number(band), param, Number(delta))));
    } else {
      console.log('использование: show | open [IN1|IN2] | on|off [IN1|IN2] | nudge <IN1> <band> <gain|freq|q> <delta>');
    }
  } catch (e) {
    console.log('ошибка:', e.message);
  }
}
