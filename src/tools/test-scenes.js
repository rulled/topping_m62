/**
 * ПРОВЕРКА: сцены и модель микшера (браузерные модули, без устройства).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `web/scenes.js` и `web/mixer-state.js` — чистая логика над
 * `localStorage`. Их можно проверить в Node, подсунув поддельное
 * хранилище. Это дешевле и надёжнее, чем щёлкать в браузере.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 *   1. модель микшера: пустая матрица, правка ячейки, diff,
 *      подсчёт известных, сохранение и загрузка;
 *   2. сцены: сохранение, список, чтение, удаление, лимит имени;
 *   3. ЧЕСТНОСТЬ: сцена обязана перечислять, что не восстановит.
 *
 * Запуск: node src/tools/test-scenes.js
 */

import {
  clearMixerState,
  countKnown,
  diffMatrix,
  emptyMatrix,
  loadMixerState,
  saveMixerState,
  setCell,
} from '../../mixer-state.js';
import {
  clearScenes,
  getScene,
  listScenes,
  removeScene,
  saveScene,
  sceneLimitations,
  UNREADABLE_GROUPS,
} from '../../scenes.js';
import { MIXER_BUSES, MIXER_SOURCES } from '../mixer-tags.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

/** Поддельное localStorage — как в браузере, но в памяти. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
  };
}

// ═══ МОДЕЛЬ МИКШЕРА ═══
console.log('\n--- модель микшера ---');
{
  const store = fakeStorage();

  const empty = emptyMatrix(MIXER_BUSES, MIXER_SOURCES);
  check('пустая матрица: 5 шин', Object.keys(empty).length === 5, `${Object.keys(empty).length}`);
  check('пустая матрица: 11 источников в шине',
    Object.keys(empty.a).length === 11, `${Object.keys(empty.a).length}`);
  check('пустая матрица: все ячейки null (тишина, а не 0 дБ)',
    Object.values(empty.a).every((c) => c.l === null && c.r === null));

  const c0 = countKnown(empty);
  check('countKnown: 0 из 55', c0.known === 0 && c0.total === 55,
    `${c0.known}/${c0.total}`);

  // setCell не мутирует исходную матрицу
  const next = setCell(empty, 'b', 'pb12', { l: 0, r: 0 });
  check('setCell не мутирует исходную', empty.b.pb12.l === null);
  check('setCell задаёт значение', next.b.pb12.l === 0 && next.b.pb12.r === 0);
  check('countKnown после правки: 1', countKnown(next).known === 1);

  // diff находит ровно изменённое
  const d = diffMatrix(empty, next);
  check('diffMatrix: одно изменение',
    d.length === 1 && d[0].bus === 'b' && d[0].source === 'pb12',
    JSON.stringify(d));

  const same = diffMatrix(next, next);
  check('diffMatrix: без изменений — пусто', same.length === 0, `${same.length}`);

  // сохранение и загрузка
  check('loadMixerState: пусто -> null', loadMixerState(store) === null);

  const saved = saveMixerState(next, store);
  check('saveMixerState: ok', saved.ok === true, saved.error ?? '');

  const loaded = loadMixerState(store);
  check('loadMixerState: вернул сохранённое',
    loaded?.matrix?.b?.pb12?.l === 0, JSON.stringify(loaded?.matrix?.b?.pb12));

  // чужая версия не принимается
  store.setItem('m62.mixer.v1', JSON.stringify({ version: 99, matrix: {} }));
  check('loadMixerState: чужая версия -> null', loadMixerState(store) === null);

  // битый JSON не роняет
  store.setItem('m62.mixer.v1', '{это не json');
  check('loadMixerState: битый JSON -> null', loadMixerState(store) === null);

  clearMixerState(store);
  check('clearMixerState: стёрто', loadMixerState(store) === null);
}

// ═══ СЦЕНЫ ═══
console.log('\n--- сцены ---');
{
  const store = fakeStorage();

  check('список пуст в начале', listScenes(store).length === 0);

  const r1 = saveScene('вокал', {
    params: { '0x91:0x03': 4, '0x46:0x02': -20 },
    model: { b: { pb12: { l: 0, r: 0 } } },
  }, store);
  check('saveScene: ok', r1.ok === true, r1.error ?? '');

  const list = listScenes(store);
  check('listScenes: одна сцена', list.length === 1, `${list.length}`);
  check('listScenes: имя и число параметров',
    list[0].name === 'вокал' && list[0].paramCount === 2,
    JSON.stringify(list[0]));
  check('listScenes: модель отмечена', list[0].hasModel === true);

  const scene = getScene('вокал', store);
  check('getScene: параметры на месте',
    scene?.params?.['0x91:0x03'] === 4, JSON.stringify(scene?.params));
  check('getScene: модель на месте', scene?.model?.b?.pb12?.l === 0);

  // ─── ЧЕСТНОСТЬ: сцена обязана перечислять нечитаемое ───
  check('сцена хранит список нечитаемого',
    Array.isArray(scene?.unreadable) && scene.unreadable.length > 0,
    JSON.stringify(scene?.unreadable));
  check('в нечитаемом есть микшер',
    (scene?.unreadable ?? []).includes('mixer'));
  check('sceneLimitations возвращает список',
    sceneLimitations(scene).length === UNREADABLE_GROUPS.length,
    `${sceneLimitations(scene).length}`);

  // пустое имя отклоняется
  const bad = saveScene('   ', {}, store);
  check('saveScene: пустое имя -> ошибка', bad.ok === false, bad.error ?? '');

  // слишком длинное имя
  const long = saveScene('x'.repeat(41), {}, store);
  check('saveScene: имя >40 -> ошибка', long.ok === false, long.error ?? '');

  // перезапись сцены с тем же именем
  saveScene('вокал', { params: { '0x91:0x03': 9 } }, store);
  check('перезапись сцены обновляет параметры',
    getScene('вокал', store).params['0x91:0x03'] === 9);
  check('перезапись не создаёт дубль', listScenes(store).length === 1);

  // вторая сцена
  saveScene('гитара', { params: {} }, store);
  check('две сцены', listScenes(store).length === 2, `${listScenes(store).length}`);

  // удаление
  const rm = removeScene('гитара', store);
  check('removeScene: ok', rm.ok === true, rm.error ?? '');
  check('после удаления одна сцена', listScenes(store).length === 1);

  const rmMissing = removeScene('нет такой', store);
  check('removeScene: отсутствующая -> ошибка', rmMissing.ok === false);

  clearScenes(store);
  check('clearScenes: пусто', listScenes(store).length === 0);

  // битое хранилище не роняет
  store.setItem('m62.scenes.v1', 'не json');
  check('битое хранилище -> пустой список', listScenes(store).length === 0);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
