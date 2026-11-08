/**
 * Уровень контролов: превращает TT/PP в именованные параметры,
 * применяет диапазоны и кривые.
 */

import {
  SELECTORS,
  SOURCES,
  VOLUMES,
  indexToDb,
  sourceIndex,
  sourceValue,
} from './controls.js';

export class ControlService {
  /**
   * @param {import('./transport.js').M62Transport} transport
   */
  constructor(transport, { logger = console } = {}) {
    this.t = transport;
    this.log = logger;
    this.volumes = new Map(VOLUMES.map((v) => [`${v.target}:${v.prop}`, v]));
    this.selectors = new Map(
      SELECTORS.map((s) => [`${s.target}:${s.prop}`, s]),
    );
  }

  /** Описание всех контролов — для API/фронта. */
  describe() {
    return {
      volumes: VOLUMES.map((v) => ({
        id: v.id,
        name: v.name,
        min: v.min,
        max: v.max,
        current: this.t.get(v.target, v.prop),
        db: this.#dbOrNull(v.id, this.t.get(v.target, v.prop)),
        hasPair: v.targetPair !== 0,
      })),
      selectors: SELECTORS.map((s) => {
        const cur = this.t.get(s.target, s.prop);
        return {
          id: s.id,
          name: s.name,
          // Селектор устройство не отчётывает: значение известно
          // только если мы его сами записали.
          current: cur,
          currentLabel:
            cur === null
              ? 'Unknown'
              : (SOURCES.find((x) => x.value === cur)?.label ?? 'Unknown'),
        };
      }),
      // Полный список источников — нужен фронту для отрисовки селекторов.
      sources: SOURCES.map((o) => ({
        index: o.index,
        label: o.label,
        value: o.value,
        isChoice: o.isChoice,
      })),
    };
  }

  #dbOrNull(id, index) {
    if (index === null || index === undefined) return null;
    const v = VOLUMES.find((x) => x.id === id);
    if (!v) return null;
    return indexToDb(index, v.tlv);
  }

  /**
   * Установить громкость.
   * @param {string} id
   * @param {number} value
   */
  setVolume(id, value) {
    const v = VOLUMES.find((x) => x.id === id);
    if (!v) throw new Error(`неизвестный волум: ${id}`);
    if (!Number.isInteger(value) || value < v.min || value > v.max) {
      throw new Error(`значение вне диапазона ${v.min}..${v.max}: ${value}`);
    }

    // Выходы идут парами: устройство объявляет только второй элемент,
    // поэтому пишем оба.
    this.t.send(v.target, v.prop, value);
    if (v.targetPair) this.t.send(v.targetPair, v.prop, value);

    // Устройство не подтверждает запись — обновляем кеш сами.
    this.t.cache.set(`${v.target}:${v.prop}`, value);
    return { id, value, db: indexToDb(value, v.tlv) };
  }

  /**
   * Установить селектор.
   * @param {string} id
   * @param {number} index индекс в списке источников
   */
  setSelector(id, index) {
    const s = SELECTORS.find((x) => x.id === id);
    if (!s) throw new Error(`неизвестный селектор: ${id}`);

    const src = SOURCES[index];
    if (!src) throw new Error(`неизвестный индекс источника: ${index}`);

    // "Unknown" — не выбор. Запись его = тихий no-op.
    if (!src.isChoice) return { id, index, noop: true };

    // Селектор отвечает только на одном target пары.
    this.t.send(s.target, s.prop, src.value);
    this.t.cache.set(`${s.target}:${s.prop}`, src.value);
    return { id, index, value: src.value, label: src.label };
  }

  /** Разбирает входящее событие в именованный вид. */
  classify(ev) {
    const vkey = `${ev.target}:${ev.prop}`;
    const v = this.volumes.get(vkey);
    if (v) {
      return {
        ...ev,
        kind: 'volume',
        id: v.id,
        name: v.name,
        db: indexToDb(ev.value, v.tlv),
      };
    }
    const s = this.selectors.get(vkey);
    if (s) {
      return {
        ...ev,
        kind: 'selector',
        id: s.id,
        name: s.name,
        label: SOURCES.find((x) => x.value === ev.value)?.label ?? 'Unknown',
      };
    }
    return { ...ev, kind: 'unknown' };
  }

  /** Отправляет текущее состояние селекторов (они не читаются). */
  restoreSelectors(state) {
    for (const [id, index] of Object.entries(state ?? {})) {
      try {
        this.setSelector(id, Number(index));
      } catch (err) {
        this.log.warn?.(`[m62] не удалось восстановить селектор ${id}: ${err.message}`);
      }
    }
  }
}

export { sourceIndex, sourceValue };
