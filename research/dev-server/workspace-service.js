/**
 * СЕРВИС WORKSPACE: то, чего нет в HID.
 *
 * Микшер, EQ, 48V, MIC, loopback, выходы, ducking — читаются из INI-файла
 * workspace, который ведёт M Control Center.
 *
 * ЗАПИСЬ (проверено, research/WRITE-METHOD.md):
 *   - правка файла при РАБОТАЮЩЕМ MCC не применяется (MCC держит состояние
 *     в памяти и перезаписывает файл);
 *   - правка файла + ПЕРЕЗАПУСК MCC — ПРИМЕНЯЕТСЯ.
 *
 * Поэтому запись реализована через `applyChanges()`: закрыть MCC,
 * записать файл, запустить MCC.
 */
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  findActiveWorkspace,
  listWorkspaces,
  parseAll,
  readWorkspace,
  writeWorkspace,
} from './workspace.js';

/** Путь к M Control Center. */
export const MCC_EXE =
  String.raw`C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запущен ли MCC. */
function mccRunning() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        '(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'],
      { encoding: 'utf8' },
    ).trim();
    return Number(out) > 0;
  } catch {
    return false;
  }
}

/**
 * Останавливает MCC перед правкой workspace-файла.
 *
 * ВАЖНО: MCC может быть запущен с правами администратора (например, если
 * его поднял скрипт захвата USBPcap). В этом случае Stop-Process вернёт
 * "Access is denied" и упадёт весь запрос — хотя MCC просто не наш.
 *
 * Правильное поведение: попытаться, а при отказе честно сказать, что
 * правка невозможна, пока MCC работает. Не бросать исключение.
 *
 * @returns {{stopped: boolean, reason?: string}}
 */
function stopMcc() {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue; exit 0'],
      { encoding: 'utf8' },
    );
    return { stopped: true };
  } catch (err) {
    return { stopped: false, reason: err.message };
  }
}

function startMcc() {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Start-Process "${MCC_EXE}"`],
    { encoding: 'utf8' },
  );
}

/** Диапазоны и форматы для валидации значений workspace.
 *
 * ВАЖНО: диапазоны РАЗНЫЕ у разных сущностей (проверено в UI, NOTES §90):
 *   Input_IN1/IN2.GAIN  — 0..88  (усиление микрофона, как громкость из HID)
 *   Input_AUX/BT/OTGIN.GAIN — -90..12
 *   микшер Mix<X>_GAIN  — -90..12
 *   Output/Loopback.GAIN — -90..12
 */
const RULES = {
  // усиление МИКРОФОНА (Input_IN1/IN2) — проверено перетаскиванием до упора
  micGain: { min: 0, max: 88 },
  // микшер и уровни: -90..12 дБ
  mixerGain: { min: -90, max: 12 },
  // уровни эффектов: -90..12 дБ
  fxLevel: { min: -90, max: 12 },
  // шумоподавление: 0..100
  noiseReduction: { min: 0, max: 100 },
  // частота EQ: 20..20000 Гц
  eqFreq: { min: 20, max: 24000 },
  // Q: 0.1..20
  eqQ: { min: 0.05, max: 20 },
  // gain EQ: -24..24 дБ
  eqGain: { min: -24, max: 24 },
  // типы фильтров EQ: 0..5 (наблюдено)
  eqType: { min: 0, max: 5 },
};

const isNum = (v) => v !== null && v !== '' && Number.isFinite(Number(v));

function inRange(label, v, rule) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label}: ожидалось число, получили "${v}"`);
  if (n < rule.min || n > rule.max) {
    throw new Error(`${label}: значение ${n} вне диапазона ${rule.min}..${rule.max}`);
  }
  return n;
}

/**
 * Проверить значение перед записью в workspace.
 *
 * Проверено (NOTES §89): без этой проверки бекенд писал мусор —
 * `MixA_GAIN = -500`, `48V = 5`, EQ-строка `garbage`.
 *
 * @param {string} section
 * @param {string} key
 * @param {string|number|boolean} value
 */
export function validateWorkspaceValue(section, key, value) {
  const id = `${section}.${key}`;

  // --- флаги ---
  if (key === '48V' || key === 'MUTE' || key === 'SOLO' || key === 'Link'
      || /^MUTE(Left|Right)$/.test(key) || /^SOLO(Left|Right)$/.test(key)) {
    const ok = value === 0 || value === 1 || value === '0' || value === '1'
      || value === true || value === false || value === 'true' || value === 'false';
    if (!ok) throw new Error(`${id}: ожидалось 0/1/true/false, получили "${value}"`);
    return;
  }

  // --- Switch (EQ, компрессор, ducking) ---
  if (key === 'Switch' || key === 'DuckingSwitch') {
    const ok = value === 0 || value === 1 || value === '0' || value === '1'
      || value === true || value === false || value === 'true' || value === 'false';
    if (!ok) throw new Error(`${id}: ожидалось 0/1/true/false, получили "${value}"`);
    return;
  }

  // --- усиления микшера ---
  if (/^Mix[A-H]_GAIN$/.test(key)) {
    inRange(id, value, RULES.mixerGain);
    return;
  }
  // --- усиления ---
  if (key === 'GAIN') {
    // Усиление МИКРОФОНА (Input_IN1/IN2) — 0..88
    // Остальные входы (AUX/BT/OTGIN) и выходы — -90..12
    if (section === 'Input_IN1' || section === 'Input_IN2') {
      inRange(id, value, RULES.micGain);
    } else {
      inRange(id, value, RULES.mixerGain);
    }
    return;
  }
  if (/^GAIN(Left|Right)$/.test(key)) {
    inRange(id, value, RULES.mixerGain);
    return;
  }

  // --- уровни эффектов ---
  if (/^(Input\dLevel|AuxLevel|BluetoothLevel|OtgLevel)$/.test(key)) {
    inRange(id, value, RULES.fxLevel);
    return;
  }
  if (/^NoiseReduction(NC1|NC2|Bypass)$/.test(key)) {
    inRange(id, value, RULES.noiseReduction);
    return;
  }
  if (/^(Reverb|DryWet|Decay)(Studio|Live|Hall|Bypass)$/.test(key)) {
    inRange(id, value, { min: 0, max: 100 });
    return;
  }
  if (/^Width(Studio|Live|Hall|Bypass)$/.test(key)) {
    // ширина хранится как float32 0..1
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`${id}: ширина должна быть 0..1, получили "${value}"`);
    }
    return;
  }

  // --- компрессор ---
  if (key === 'Threshold') { inRange(id, value, { min: -60, max: 0 }); return; }
  if (key === 'Ratio') { inRange(id, value, { min: 1, max: 20 }); return; }
  if (key === 'Attack') { inRange(id, value, { min: 0, max: 200 }); return; }
  if (key === 'Release') { inRange(id, value, { min: 0, max: 2000 }); return; }
  if (key === 'Mix') { inRange(id, value, { min: 0, max: 100 }); return; }
  if (key === 'Reduction') { inRange(id, value, { min: 0, max: 60 }); return; }

  // --- EQ-полосы ---
  if (/^Eq%40\d+$/.test(key)) {
    validateEqBand(id, section, value);
    return;
  }

  // --- GainInput / GainOutput у EQ ---
  if (key === 'GainInput' || key === 'GainOutput') {
    inRange(id, value, RULES.mixerGain);
    return;
  }
}

/**
 * Валидация строки EQ-полосы.
 *
 * Два формата (проверено, NOTES §8):
 *   EQ_IN1/IN2: `|тип|частота|Q|gain|`
 *   EQ_HP:      `тип|gain|частота|Q|флаг`
 */
function validateEqBand(id, section, value) {
  const s = String(value);
  const parts = s.split('|').filter((x) => x !== '');

  // ВАЖНО (исправлено 2026-11-07): формат НЕ зависит от секции.
  // Оба формата встречаются и в EQ_IN1/IN2, и в EQ_HP:
  //   5 полей: "тип|gain|частота|Q|флаг"   (после правки в UI MCC)
  //   4 поля: "тип|частота|Q|gain"         (исходный, ведущий '|' отброшен)
  // Раньше выбирали по секции -> 5-польный файл из EQ_IN1 парсился как
  // 4-польный, gain (-5.9) уходил в проверку частоты и валидация падала
  // (аудит поймал: EQ_IN1.Eq%401 = "0|-5.9|3811|0.2441|0").
  // Определяем формат по ДЛИНЕ, а не по секции.
  let type, gain, freq, q;

  if (parts.length >= 5) {
    // тип|gain|частота|Q|флаг
    [type, gain, freq, q] = parts;
  } else if (parts.length === 4) {
    // тип|частота|Q|gain
    [type, freq, q, gain] = parts;
  } else {
    throw new Error(`${id}: ожидалось 4 или 5 полей через '|', получили "${s}"`);
  }

  if (!Number.isFinite(Number(gain))) {
    throw new Error(`${id}: gain не число в "${s}"`);
  }

  inRange(`${id}.тип`, type, RULES.eqType);
  inRange(`${id}.gain`, gain, RULES.eqGain);
  inRange(`${id}.частота`, freq, RULES.eqFreq);
  inRange(`${id}.Q`, q, RULES.eqQ);
}

export class WorkspaceService {
  constructor({ logger = console } = {}) {
    this.log = logger;
    this._cache = null;
    this._cachePath = null;
    this._cacheMtime = null;
  }

  /** Список всех workspace. */
  list() {
    return listWorkspaces().map((w) => ({
      mode: w.mode,
      name: w.name,
      path: w.path,
      mtime: w.mtime.toISOString(),
      size: w.size,
    }));
  }

  /** Активный workspace (самый свежий). */
  active() {
    return findActiveWorkspace();
  }

  /**
   * Полное состояние из активного workspace.
   * Кешируется по mtime файла.
   */
  describe() {
    const ws = this.active();
    if (!ws) {
      return { available: false, reason: 'workspace-файлы не найдены' };
    }

    const mtime = ws.mtime.getTime();
    if (this._cache && this._cachePath === ws.path && this._cacheMtime === mtime) {
      return this._cache;
    }

    let parsed;
    try {
      parsed = parseAll(readWorkspace(ws.path));
    } catch (err) {
      this.log.warn?.(`[workspace] не удалось прочитать ${ws.path}: ${err.message}`);
      return { available: false, reason: err.message, path: ws.path };
    }

    const out = {
      available: true,
      mode: ws.mode,
      name: ws.name,
      path: ws.path,
      mtime: ws.mtime.toISOString(),
      ...parsed,
      caveats: [
        'данные из workspace-файла MCC, а не от устройства',
        'файл обновляется по действиям в UI',
        'запись в файл вручную MCC не применяет',
      ],
    };

    this._cache = out;
    this._cachePath = ws.path;
    this._cacheMtime = mtime;
    return out;
  }

  /** Только микшер. */
  mixer() {
    const d = this.describe();
    return d.available ? d.mixer : [];
  }

  /** Только EQ. */
  eq() {
    const d = this.describe();
    return d.available ? d.eq : [];
  }

  /** Только входы (MIC, 48V, GAIN…). */
  inputs() {
    const d = this.describe();
    return d.available ? d.inputs : [];
  }

  /** Только loopback. */
  loopback() {
    const d = this.describe();
    return d.available ? d.loopback : [];
  }

  /** Только выходы. */
  outputs() {
    const d = this.describe();
    return d.available ? d.outputs : [];
  }

  /** Сбросить кеш (после изменения файла). */
  invalidate() {
    this._cache = null;
    this._cachePath = null;
    this._cacheMtime = null;
  }

  /**
   * Записать изменения в workspace и применить их к устройству.
   *
   * ПРОВЕРЕННЫЙ МЕТОД (research/WRITE-METHOD.md):
   *   1. закрыть MCC
   *   2. записать файл
   *   3. запустить MCC
   * После старта MCC применяет значения из файла.
   *
   * @param {Array<{section: string, key: string, value: string|number|boolean}>} changes
   * @param {{restart?: boolean, waitStopMs?: number, waitStartMs?: number}} [opts]
   */
  async applyChanges(changes, opts = {}) {
    const {
      restart = true,
      waitStopMs = 4000,
      waitStartMs = 13000,
    } = opts;

    if (!Array.isArray(changes) || !changes.length) {
      throw new Error('changes пуст');
    }

    const ws = this.active();
    if (!ws) throw new Error('workspace не найден');

    // Валидация ДО остановки MCC — чтобы не оставить его выключенным
    const ini = readWorkspace(ws.path);
    for (const c of changes) {
      if (!c || typeof c.section !== 'string' || typeof c.key !== 'string') {
        throw new Error(`неверное изменение: ${JSON.stringify(c)}`);
      }
      if (!ini[c.section]) {
        throw new Error(`секция "${c.section}" не найдена в workspace`);
      }
      if (ini[c.section][c.key] === undefined) {
        throw new Error(`ключ "${c.key}" не найден в секции "${c.section}"`);
      }
      // ВАЛИДАЦИЯ ЗНАЧЕНИЯ (проверено, NOTES §89):
      // без неё бекенд писал мусор вроде MixA_GAIN=-500 или 48V=5
      validateWorkspaceValue(c.section, c.key, c.value);
    }

    const backup = ws.path + '.autobak';
    copyFileSync(ws.path, backup);

    const wasRunning = mccRunning();

    if (restart) {
      this.log.info?.('[workspace] останавливаю M Control Center…');
      stopMcc();
      await sleep(waitStopMs);
      if (mccRunning()) {
        throw new Error('не удалось остановить M Control Center');
      }
    } else if (wasRunning) {
      throw new Error(
        'MCC запущен: изменения файла не применятся. Остановите его или передайте restart: true',
      );
    }

    // перечитать после остановки — MCC мог дописать при выходе
    const fresh = readWorkspace(ws.path);
    for (const c of changes) {
      const v = typeof c.value === 'boolean' ? String(c.value) : String(c.value);
      fresh[c.section][c.key] = v;
    }
    writeWorkspace(ws.path, fresh);
    this.invalidate();

    if (restart) {
      this.log.info?.('[workspace] запускаю M Control Center…');
      startMcc();
      await sleep(waitStartMs);
      this.invalidate();
    }

    return {
      applied: changes.length,
      workspace: `${ws.mode}/${ws.name}`,
      backup,
      restarted: restart,
    };
  }

  /**
   * Записать изменение по «пути» вида:
   *   applyPath('Mixer_IN12.MixA_GAIN', 5)
   *   applyPath('Input_IN1.48V', 1)
   */
  async applyPath(path, value, opts) {
    const dot = String(path).indexOf('.');
    if (dot < 0) throw new Error(`путь должен быть "Секция.Ключ": ${path}`);
    const section = path.slice(0, dot);
    const key = path.slice(dot + 1);
    return this.applyChanges([{ section, key, value }], opts);
  }
}
