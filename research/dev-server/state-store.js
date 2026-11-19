/**
 * СОБСТВЕННОЕ ХРАНИЛИЩЕ СОСТОЯНИЯ — без зависимости от MCC.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Часть состояния устройства нельзя прочитать из HID:
 *
 *   МИКШЕР (0x31..0x3c)  — только запись, IN=0 во всех захватах
 *   LOOPBACK (0x51..0x58) — только запись, IN=0
 *   DUCKING (0x43)        — только запись, IN=0
 *
 * Раньше источником истины для них был workspace-INI MCC. Это
 * привязывало бекенд к установленному M Control Center: 7 маршрутов
 * падали, если папки `C:\Program Files\TOPPING Pro\...` нет.
 *
 * Теперь источник истины — этот модуль. Он держит JSON в
 * `%APPDATA%\m62\state.json` и не требует MCC вообще.
 *
 * ═══ ПРАВИЛА ═══
 *
 * 1. Одна модель состояния, один файл, один писатель.
 * 2. HID — источник истины для того, что ОТТУДА читается
 *    (громкости, EQ, компрессор, реверб, эффекты, метры).
 *    В этот файл такое не дублируется.
 * 3. В файле только то, что из устройства не читается:
 *    микшер, loopback, ducking, служебные предпочтения.
 * 4. Импорт из INI MCC — однократный, для миграции. Дальше INI
 *    не читается.
 *
 * ═══ ПОЧЕМУ НЕ snapshots.js ═══
 *
 * `snapshots.js` — это снимки для диагностики и откатов: полная
 * копия состояния на момент времени, с меткой даты. Их может быть
 * много, они сравниваются между собой (`diffSnapshots`).
 *
 * Здесь другое: ОДНО актуальное состояние, которое всегда
 * перезаписывается целиком. Смешивать эти роли нельзя — иначе
 * непонятно, какая из десяти «полных копий» настоящая.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Каталог состояния: %APPDATA%\m62 (или ~/.m62 вне Windows). */
export const STATE_DIR = process.env.M62_STATE_DIR
  || join(process.env.APPDATA || join(homedir(), '.config'), 'm62');

export const STATE_FILE = join(STATE_DIR, 'state.json');

/** Версия формата — чтобы понимать, когда мигрировать. */
export const STATE_VERSION = 1;

/**
 * Структура по умолчанию.
 *
 * mixer и loopback — то, что нельзя прочитать из устройства.
 * Значения микшера в дБ, ключ — `bus:source`, например `a:pb12`.
 */
function emptyState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    /** Откуда пришло начальное состояние. */
    source: 'empty',
    mixer: {
      /** { a: { pb12: 0, in1: -6 }, b: {...}, ... } */
      buses: {},
      /** Даты последней записи в устройство. */
      lastWrittenAt: null,
    },
    loopback: {
      /** { lb12: { source: 17, gain: 0 }, ... } */
      pairs: {},
      lastWrittenAt: null,
    },
    ducking: {
      values: {},
      lastWrittenAt: null,
    },
    /** Произвольные предпочтения приложения (не устройства). */
    prefs: {},
  };
}

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

/**
 * Читает состояние с диска. Если файла нет — создаёт пустое.
 * Битый файл не роняет приложение: возвращается пустое состояние
 * с пометкой, что файл был повреждён.
 */
export function load() {
  ensureDir();
  if (!existsSync(STATE_FILE)) {
    const fresh = emptyState();
    save(fresh);
    return fresh;
  }
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('не объект');
    // дозаполняем недостающие секции, не теряя имеющиеся
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      mixer: { ...base.mixer, ...(parsed.mixer ?? {}) },
      loopback: { ...base.loopback, ...(parsed.loopback ?? {}) },
      ducking: { ...base.ducking, ...(parsed.ducking ?? {}) },
      prefs: { ...base.prefs, ...(parsed.prefs ?? {}) },
    };
  } catch (err) {
    const fresh = emptyState();
    fresh.source = `corrupted: ${String(err?.message ?? err)}`;
    return fresh;
  }
}

/**
 * Пишет состояние на диск АТОМАРНО: сначала во временный файл,
 * потом переименование. Иначе падение посреди записи оставит
 * обрезанный JSON.
 */
export function save(state) {
  ensureDir();
  const withTime = { ...state, version: STATE_VERSION, updatedAt: new Date().toISOString() };
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(withTime, null, 2), 'utf8');
  renameSync(tmp, STATE_FILE);
  return withTime;
}

/** Обновляет секцию и сохраняет. */
export function update(section, patch) {
  const st = load();
  if (!st[section] || typeof st[section] !== 'object') {
    throw new Error(`неизвестная секция состояния: ${section}`);
  }
  st[section] = { ...st[section], ...patch };
  return save(st);
}

/**
 * Сохраняет матрицу микшера.
 * @param {Record<string, Record<string, number>>} buses  { a: { pb12: 0 } }
 */
export function setMixer(buses) {
  const st = load();
  st.mixer = {
    buses: buses ?? {},
    lastWrittenAt: new Date().toISOString(),
  };
  return save(st);
}

/** Сохраняет loopback. */
export function setLoopback(pairs) {
  const st = load();
  st.loopback = {
    pairs: pairs ?? {},
    lastWrittenAt: new Date().toISOString(),
  };
  return save(st);
}

/** Сохраняет ducking. */
export function setDucking(values) {
  const st = load();
  st.ducking = {
    values: values ?? {},
    lastWrittenAt: new Date().toISOString(),
  };
  return save(st);
}

/**
 * Однократный импорт из разобранного workspace MCC.
 *
 * Вызывается, когда файла состояния ещё нет, а MCC установлен —
 * чтобы не потерять текущие настройки пользователя при переходе.
 *
 * @param {{mixer?: any[], loopback?: any[], ducking?: any}} ws  результат workspace.describe()
 * @returns {{imported: boolean, mixerBuses: number, loopbackPairs: number, duckingKeys: number}}
 */
export function importFromWorkspace(ws) {
  const st = load();

  // Уже что-то есть — не затираем.
  const hasData = Object.keys(st.mixer.buses ?? {}).length > 0
    || Object.keys(st.loopback.pairs ?? {}).length > 0;
  if (hasData) {
    return {
      imported: false,
      reason: 'состояние уже заполнено',
      mixerBuses: Object.keys(st.mixer.buses ?? {}).length,
      loopbackPairs: Object.keys(st.loopback.pairs ?? {}).length,
      duckingKeys: Object.keys(st.ducking.values ?? {}).length,
    };
  }

  // Микшер: ws.mixer — массив каналов вида { channel, buses: { a: { gain, mute } } }
  const buses = {};
  for (const ch of ws?.mixer ?? []) {
    const src = ch.channel;
    if (!src) continue;
    for (const [bus, params] of Object.entries(ch.buses ?? {})) {
      if (!buses[bus]) buses[bus] = {};
      if (params?.gain !== undefined && params?.gain !== null) {
        buses[bus][src] = params.gain;
      }
    }
  }

  // Loopback: 4 пары
  const pairs = {};
  for (const lb of ws?.loopback ?? []) {
    const m = String(lb.id ?? '').match(/LB(\d+)$/);
    if (!m) continue;
    pairs[`lb${m[1]}`] = {
      source: lb.source ?? null,
      gain: lb.gain ?? null,
      mute: lb.mute ?? null,
    };
  }

  st.mixer = { buses, lastWrittenAt: null };
  st.loopback = { pairs, lastWrittenAt: null };
  st.ducking = { values: ws?.ducking ?? {}, lastWrittenAt: null };
  st.source = 'imported from MCC workspace';

  save(st);
  return {
    imported: true,
    mixerBuses: Object.keys(buses).length,
    loopbackPairs: Object.keys(pairs).length,
    duckingKeys: Object.keys(st.ducking.values).length,
  };
}

/** Краткая сводка для API. */
export function describe() {
  const st = load();
  return {
    dir: STATE_DIR,
    file: STATE_FILE,
    version: st.version,
    updatedAt: st.updatedAt,
    source: st.source,
    mixer: {
      buses: Object.keys(st.mixer.buses ?? {}),
      sources: Object.values(st.mixer.buses ?? {})
        .reduce((n, b) => n + Object.keys(b ?? {}).length, 0),
      lastWrittenAt: st.mixer.lastWrittenAt,
    },
    loopback: {
      pairs: Object.keys(st.loopback.pairs ?? {}).length,
      lastWrittenAt: st.loopback.lastWrittenAt,
    },
    ducking: {
      keys: Object.keys(st.ducking.values ?? {}).length,
      lastWrittenAt: st.ducking.lastWrittenAt,
    },
    prefs: Object.keys(st.prefs ?? {}).length,
  };
}
