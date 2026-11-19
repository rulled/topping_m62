/**
 * СЦЕНЫ (браузер, localStorage).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Пользователь настраивает карту под задачу: вокал, гитара, подкаст.
 * Переключаться между наборами вручную — это десятки движений.
 * Сцена сохраняет набор и восстанавливает его одним нажатием.
 *
 * ═══ ПОЧЕМУ localStorage, А НЕ СЕРВЕР ═══
 *
 * Сервер не должен знать, что пользователь настроил: данные карты
 * не покидают его компьютер. Серверное хранилище потребовало бы
 * идентификации и хранения чужого состояния без нужды.
 *
 * ═══ ГЛАВНОЕ: СЦЕНА НЕ ВРЁТ ═══
 *
 * Часть состояния карта не отдаёт назад. Микшер — вообще не отдаёт
 * (доказано: 1600 записей, 0 чтений). Если сцена сохранит «микшер:
 * вот такие значения» и при загрузке их запишет, пользователь
 * получит НЕ то, что было, а нашу выдумку.
 *
 * Поэтому в сцене два раздельных поля:
 *
 *   params     — то, что карта реально отдаёт; при загрузке пишем
 *                и можем проверить;
 *   model      — то, что приходит только из нашей модели (микшер);
 *                пишем, но НЕ утверждаем, что это было на карте.
 *
 * Поле `unreadable` перечисляет группы, которых в сцене нет вовсе.
 * Так сцена честно говорит, что именно она восстановит.
 */

/** Ключ в localStorage. */
export const SCENES_KEY = 'm62.scenes.v1';

/** Версия формата. */
export const SCENES_VERSION = 1;

/**
 * Группы, которые карта не отдаёт и которые сцена не сохраняет.
 *
 * Здесь перечислено то, что мы НЕ умеем читать. Список — часть
 * данных сцены, а не комментарий: интерфейс показывает его
 * пользователю, чтобы не создавать ложного впечатления.
 */
export const UNREADABLE_GROUPS = [
  'mixer',      // 1600 записей, 0 чтений — только наша модель
  'loopback',   // приходит только в bulk push, обратно нет
  'ducking',    // то же
  'selectors',  // 0x9b читается частично
];

/**
 * Матрица микшера: шина -> источник -> уровни L/R.
 *
 * `null` в уровне означает «−∞» (полное глушение). Ноль — это валидный
 * уровень 0 дБ, поэтому путать нельзя.
 *
 * @typedef {Record<string, Record<string, {l:number|null, r:number|null}>>} MixerMatrix
 */

/**
 * Сохранённая сцена.
 *
 * @typedef {object} Scene
 * @property {string} name
 * @property {string} createdAt        ISO-дата создания
 * @property {Record<string, number>} params  читаемые параметры, ключ "0xTT:0xPP"
 * @property {MixerMatrix|null} model  модель микшера (карта её не отдаёт)
 * @property {string} source
 * @property {string[]} unreadable     группы, которых в сцене нет
 */

/**
 * Прочитать все сцены.
 * @param {Storage} [storage]
 * @returns {{version:number, scenes:Record<string, Scene>}}
 */
function readStore(storage) {
  try {
    const raw = storage?.getItem(SCENES_KEY);
    if (!raw) return { version: SCENES_VERSION, scenes: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SCENES_VERSION || typeof parsed.scenes !== 'object') {
      return { version: SCENES_VERSION, scenes: {} };
    }
    return parsed;
  } catch {
    return { version: SCENES_VERSION, scenes: {} };
  }
}

/** Записать хранилище. */
function writeStore(store, storage) {
  try {
    storage?.setItem(SCENES_KEY, JSON.stringify(store));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Сохранить сцену.
 *
 * @param {string} name
 * @param {{params?:Record<string, number>, model?:MixerMatrix|null, source?:string}} payload
 *        params — адреса, прочитанные с карты
 *        model  — наша модель (микшер и т.п.)
 * @param {Storage} [storage]
 * @returns {{ok:boolean, error?:string}}
 */
export function saveScene(name, payload = {}, storage = globalThis.localStorage) {
  const clean = String(name ?? '').trim();
  if (!clean) return { ok: false, error: 'нужно имя сцены' };
  if (clean.length > 40) return { ok: false, error: 'имя длиннее 40 символов' };

  const store = readStore(storage);
  store.scenes[clean] = {
    name: clean,
    createdAt: new Date().toISOString(),
    params: payload.params ?? {},
    model: payload.model ?? null,
    source: payload.source ?? 'browser',
    unreadable: UNREADABLE_GROUPS,
  };
  return writeStore(store, storage);
}

/**
 * Список сцен (имена и даты), без тяжёлых данных.
 * @param {Storage} [storage]
 * @returns {Array<{name:string, createdAt:string, paramCount:number, hasModel:boolean}>}
 */
export function listScenes(storage = globalThis.localStorage) {
  const store = readStore(storage);
  return Object.values(store.scenes)
    .map((s) => ({
      name: s.name,
      createdAt: s.createdAt,
      paramCount: Object.keys(s.params ?? {}).length,
      hasModel: !!s.model,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Получить сцену целиком.
 * @param {string} name
 * @param {Storage} [storage]
 * @returns {Scene|null}
 */
export function getScene(name, storage = globalThis.localStorage) {
  const store = readStore(storage);
  return store.scenes[String(name)] ?? null;
}

/**
 * Удалить сцену.
 * @param {string} name
 * @param {Storage} [storage]
 * @returns {{ok:boolean, error?:string}}
 */
export function removeScene(name, storage = globalThis.localStorage) {
  const store = readStore(storage);
  const key = String(name);
  if (!store.scenes[key]) return { ok: false, error: 'нет такой сцены' };
  delete store.scenes[key];
  return writeStore(store, storage);
}

/**
 * Удалить все сцены.
 * @param {Storage} [storage]
 * @returns {{ok:boolean}}
 */
export function clearScenes(storage = globalThis.localStorage) {
  return writeStore({ version: SCENES_VERSION, scenes: {} }, storage);
}

/**
 * Что сцена НЕ восстановит — для честного показа пользователю.
 *
 * @param {Scene|null} scene
 * @returns {string[]}
 */
export function sceneLimitations(scene) {
  if (!scene) return [];
  return Array.isArray(scene.unreadable) && scene.unreadable.length
    ? [...scene.unreadable]
    : [...UNREADABLE_GROUPS];
}
