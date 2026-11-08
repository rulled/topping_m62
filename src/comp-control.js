/**
 * УПРАВЛЕНИЕ КОМПРЕССОРОМ ЧЕРЕЗ ОКНО COMP.
 *
 * ═══ КАК ЭТО РАБОТАЕТ ═══
 *
 * Кнопка MORE на панели эффектов открывает ОТДЕЛЬНОЕ окно класса
 * `CompressorS1M1` с шестью дилами: Threshold, Ratio, Attack, Release,
 * Gain, Mix + переключатели Switch (в заголовке) и Auto (GainAuto).
 *
 * Дилы НЕ принимают ни drag, ни колесо, ни ValuePattern.SetValue.
 * Работает только КЛАВИАТУРА: SetFocus на дил + стрелки (по 1 шагу).
 *
 * ⚠️ КРИТИЧНО: окно COMP — отдельное top-level окно Qt. SendKeys отправляет
 * клавиши в ПЕРЕДНЕЕ окно (foreground), поэтому окно надо поднимать через
 * AttachThreadInput + BringWindowToTop + SetForegroundWindow. Если этого не
 * сделать, клавиши улетят в другое приложение (наблюдалось: в меню «Пуск»).
 * `comp-key.ps1 press` проверяет foreground ДО и ПОСЛЕ установки фокуса.
 *
 * ═══ ПОЧЕМУ НЕ РАБОТАЛИ ПРОШЛЫЕ ПОПЫТКИ ═══
 * Раунды 20–21 перебирали dial'ы через drag и колесо. Клавиатуру не пробовали —
 * её нашли только при реверсе EQ (NOTES §110), уже после того, как компрессор
 * объявили тупиком. Плюс окно COMP открывается кнопкой MORE, которую тогда
 * не заметили: искали внутри главного окна, а оно отдельное.
 *
 * Проверено 2026-11-07: все шесть параметров пишутся, точность 1 шаг.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { findActiveWorkspace, readWorkspace } from './workspace.js';
import {
  COMP_PARAMS_ORDER,
  COMP_RANGES,
  compPresses,
  compSnap,
  compValidate,
  describeCompressor,
  ratioAtIndex,
  ratioToIndex,
} from './comp-scales.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PS1 = path.join(HERE, 'tools', 'comp-key.ps1');

/** Задержка между нажатиями по умолчанию, мс. */
export const PRESS_DELAY_MS = 90;
/** Сколько ждать записи файла после последнего нажатия. */
export const FILE_SETTLE_MS = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(args) {
  let res;
  try {
    res = execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args.map(String)],
      { encoding: 'utf8' });
  } catch (err) {
    // execFileSync бросает на ненулевом коде выхода, но осмысленный ответ
    // (NOT_FOREGROUND / NO_COMPWIN / ...)leжит в stdout — достаём его.
    const out = String(err.stdout ?? '').trim();
    if (out) return out;
    const errOut = String(err.stderr ?? '').trim();
    throw new Error(`comp-key.ps1 ${args[0]}: ${errOut || err.message}`);
  }
  return res.trim();
}

/** Состояние окна COMP: открыто ли, в фокусе ли, состояния переключателей. */
export function compWindowState() {
  const raw = ps(['state']);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`не удалось разобрать состояние окна COMP: ${raw}`);
  }
}

/** Открыть окно COMP (клик по MORE). Идемпотентно. */
export function openCompWindow() {
  const r = ps(['open']);
  if (r === 'OPEN_FAILED') throw new Error('окно COMP не открылось после клика по MORE');
  if (r === 'NO_MORE_BUTTON') throw new Error('кнопка MORE не найдена — MCC не на главной странице?');
  return r;
}

/**
 * Текущие значения компрессора ИЗ ФАЙЛА workspace.
 * Это единственный источник правды: окно COMP не показывает числа в UIA
 * (дилы рисуют значение сами, отдельных QLabel/QLineEdit со значением нет).
 */
export function readCompressorValues() {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    path: ws.path,
    Switch: String(c.Switch) === 'true',
    Threshold: num(c.Threshold),
    Ratio: num(c.Ratio),
    Attack: num(c.Attack),
    Release: num(c.Release),
    Gain: num(c.Gain),
    Mix: num(c.Mix),
    GainAuto: String(c.GainAuto) === 'true',
    raw: { ...c },
  };
}

/**
 * Послать клавиши в дил.
 * @param {string} param Threshold|Ratio|Attack|Release|Gain|Mix
 * @param {number} times сколько нажатий
 * @param {'up'|'down'} dir
 */
export function pressCompDial(param, times, dir = 'up') {
  if (!COMP_PARAMS_ORDER.includes(param)) {
    throw new Error(`неизвестный параметр компрессора: ${param}`);
  }
  if (!Number.isInteger(times) || times <= 0) {
    throw new Error(`times должно быть целым > 0, получено ${times}`);
  }
  // окно могло быть закрыто — открываем сами, чтобы не падать
  let st;
  try {
    st = compWindowState();
  } catch {
    st = { open: false };
  }
  if (!st.open) openCompWindow();

  const key = dir === 'down' ? '{DOWN}' : '{UP}';
  const out = ps(['press', param, key, times, PRESS_DELAY_MS]);
  if (out.startsWith('NOT_FOREGROUND') || out.startsWith('LOST_FOCUS')) {
    throw new Error(
      `окно COMP не в фокусе — клавиши не отправлены (${out}). ` +
      'Это защита: иначе они уйдут в другое приложение.',
    );
  }
  if (out === 'NO_COMPWIN') throw new Error('окно COMP не открыто — вызовите openCompWindow()');
  if (out === 'NO_DIAL') throw new Error(`дил ${param} не найден в окне COMP`);
  return out;
}

/**
 * Установить параметр в целевое значение.
 * Читает текущее из файла, считает нажатия по шкале, крутит дил.
 *
 * @returns {{param, before, after, target, presses, changed, verified}}
 */
export async function setCompressorParam(param, target) {
  if (!COMP_PARAMS_ORDER.includes(param)) {
    throw new Error(`неизвестный параметр: ${param}`);
  }
  const v = compValidate(param, target);
  if (!v.ok) throw new Error(v.reason);

  const want = compSnap(param, target);
  const before = readCompressorValues()[param];

  if (before !== null && Math.abs(before - want) < 1e-6) {
    return { param, before, after: before, target: want, presses: 0, changed: false, verified: true };
  }

  const presses = compPresses(param, before ?? COMP_RANGES[param].min, want);
  if (presses === 0) {
    return { param, before, after: before, target: want, presses: 0, changed: false, verified: true };
  }

  pressCompDial(param, Math.abs(presses), presses > 0 ? 'up' : 'down');
  await sleep(FILE_SETTLE_MS);

  const after = readCompressorValues()[param];
  const verified = after !== null && Math.abs(after - want) < 0.05;
  return { param, before, after, target: want, presses, changed: after !== before, verified };
}

/** Сдвинуть параметр на delta шагов (без чтения цели). */
export async function nudgeCompressorParam(param, delta) {
  if (!COMP_PARAMS_ORDER.includes(param)) throw new Error(`неизвестный параметр: ${param}`);
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta должно быть целым ≠ 0');
  const before = readCompressorValues()[param];
  pressCompDial(param, Math.abs(delta), delta > 0 ? 'up' : 'down');
  await sleep(FILE_SETTLE_MS);
  const after = readCompressorValues()[param];
  return { param, before, after, delta, changed: after !== before };
}

/** Включить/выключить сам компрессор (переключатель в заголовке окна COMP). */
export async function setCompressorSwitch(on) {
  const st = compWindowState();
  if (!st.open) openCompWindow();
  const cur = compWindowState().switch;
  const wantOn = Boolean(on);
  if ((cur === 'On') === wantOn) {
    return { before: cur, after: cur, changed: false };
  }
  const out = ps(['toggle', 'switch']);
  await sleep(FILE_SETTLE_MS);
  const after = compWindowState().switch;
  return { before: cur, after, changed: after !== cur, raw: out };
}

/** Включить/выключить Auto (авто-мейкап GainAuto). */
export async function setCompressorGainAuto(on) {
  const st = compWindowState();
  if (!st.open) openCompWindow();
  const cur = compWindowState().gainAuto;
  const wantOn = Boolean(on);
  if ((cur === 'On') === wantOn) {
    return { before: cur, after: cur, changed: false };
  }
  const out = ps(['toggle', 'gainauto']);
  await sleep(FILE_SETTLE_MS);
  const after = compWindowState().gainAuto;
  return { before: cur, after, changed: after !== cur, raw: out };
}

/** Закрыть окно COMP (клик по кнопке закрытия в заголовке). */
export function closeCompWindow() {
  const raw = ps(['close']);
  return raw;
}

/** Полный снимок: значения из файла + состояние окна. */
export function describeCompressorState() {
  const values = readCompressorValues();
  let win = null;
  try { win = compWindowState(); } catch { /* MCC может быть не запущен */ }
  return {
    values,
    window: win,
    scales: describeCompressor(),
  };
}

export {
  COMP_PARAMS_ORDER,
  COMP_RANGES,
  compPresses,
  compSnap,
  compValidate,
  describeCompressor,
  ratioAtIndex,
  ratioToIndex,
};
