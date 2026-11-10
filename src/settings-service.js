/**
 * СЕРВИС НАСТРОЕК: чтение и запись настроек M62.
 *
 * Всё, что здесь пишется в устройство, ПОДТВЕРЖДЕНО на живом устройстве
 * (см. research/PIPELINE.md §9). Значения — из перечислений в settings.js.
 *
 * Осторожно с destructive-командами: сброс к заводским настройкам
 * требует явного подтверждения от вызывающего.
 */
import {
  COMMANDS,
  DESTRUCTIVE,
  ENUMS,
  STATUS,
  TOGGLES,
  findSetting,
  labelFor,
} from './settings.js';

export class SettingsService {
  /**
   * @param {import('./transport.js').M62Transport} transport
   */
  constructor(transport, { logger = console } = {}) {
    this.t = transport;
    this.log = logger;
  }

  /**
   * Перечитать полное состояние с устройства.
   *
   * ВАЖНО (проверено `src/tools/diag-methods.js`):
   * нужен РОВНО ОДИН запрос ANNOUNCE и пауза не меньше 3 секунд.
   *
   * Замеры:
   *   1 запрос + пауза 3 с  -> 8/8 тегов настроек, 51-55 параметров ✅
   *   3 запроса по 1 с      -> 0/8 тегов, 30 параметров ❌
   *
   * То есть частые ANNOUNCE СБИВАЮТ ответ устройства: оно не успевает
   * выдать порцию и начинает заново. Никогда не шлите их подряд.
   *
   * @param {{waitMs?: number}} [opts]
   */
  async refresh({ waitMs = 3500 } = {}) {
    if (!this.t.device) throw new Error('устройство не открыто');
    this.t.send(0x11, 0x26, 1); // ANNOUNCE — ОДИН раз
    await new Promise((r) => setTimeout(r, waitMs));
    return this.describe();
  }

  /**
   * ПОЛНОЕ СОСТОЯНИЕ через Load preset.
   *
   * ПРОВЕРЕНО (research/NOTES.md §44): `Load preset1` (0x11:0x0e) заставляет
   * устройство отдать **94 параметра вместо 36**, включая все теги
   * компрессора `0x46:0x01..0x08`, которых обычный ANNOUNCE не отдаёт.
   *
   * ⚠️ ПОБОЧНЫЙ ЭФФЕКТ: это ЗАГРУЖАЕТ пресет — состояние устройства
   * меняется на сохранённое в preset1. Применять осознанно.
   *
   * @param {{which?: 1|2, waitMs?: number}} [opts]
   */
  async loadFullState({ which = 1, waitMs = 6000 } = {}) {
    if (!this.t.device) throw new Error('устройство не открыто');
    const prop = which === 2 ? 0x12 : 0x0e;
    this.t.send(0x11, prop, 1);
    await new Promise((r) => setTimeout(r, waitMs));
    return this.describe();
  }

  /** Текущее состояние всех настроек (из кеша транспорта). */
  describe() {
    const opt = (map) =>
      Object.entries(map).map(([value, label]) => ({ value: Number(value), label }));

    return {
      toggles: TOGGLES.map((t) => {
        const v = this.t.get(t.target, t.prop);
        return {
          id: t.id,
          name: t.name,
          value: v,
          label: v === null ? null : (t.values[v] ?? null),
          options: opt(t.values),
        };
      }),
      enums: ENUMS.map((e) => {
        const v = this.t.get(e.target, e.prop);
        return {
          id: e.id,
          name: e.name,
          value: v,
          label: v === null ? null : labelFor(e, v),
          // для mode значение не читается — фронт должен это знать
          readable: !e.writeOnly,
          reloadsDevice: e.id === 'mode',
          options: e.options.map((o) => ({ ...o })),
        };
      }),
      status: STATUS.map((s) => ({
        id: s.id,
        name: s.name,
        value: this.t.get(s.target, s.prop),
      })),
      commands: COMMANDS.map((c) => ({
        id: c.id,
        name: c.name,
        destructive: DESTRUCTIVE.has(c.id),
      })),
    };
  }

  /**
   * Установить тумблер.
   * @param {string} id
   * @param {boolean|number} value
   */
  setToggle(id, value) {
    const t = TOGGLES.find((x) => x.id === id);
    if (!t) throw new Error(`неизвестный тумблер: ${id}`);
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (!(v in t.values)) throw new Error(`недопустимое значение ${v} для ${id}`);
    this.t.send(t.target, t.prop, v);
    this.t.cache.set(`${t.target}:${t.prop}`, v);
    return { id, value: v, label: t.values[v] };
  }

  /**
   * Установить значение перечисления.
   * @param {string} id
   * @param {number} value
   */
  setEnum(id, value) {
    const e = ENUMS.find((x) => x.id === id);
    if (!e) throw new Error(`неизвестное перечисление: ${id}`);
    const v = Number(value);
    if (!e.options.some((o) => o.value === v)) {
      const allowed = e.options.map((o) => `${o.value}=${o.label}`).join(', ');
      throw new Error(`недопустимое значение ${v} для ${id}; допустимо: ${allowed}`);
    }
    this.t.send(e.target, e.prop, v);
    // mode не читается обратно — не кешируем как факт
    if (!e.writeOnly) this.t.cache.set(`${e.target}:${e.prop}`, v);
    return {
      id,
      value: v,
      label: labelFor(e, v),
      reloadsDevice: id === 'mode',
    };
  }

  /**
   * Сменить режим устройства.
   *
   * ПРОВЕРЕНО (NOTES §42): работает прямым HID-кадром 0x11:0x1d,
   * без UI MCC. Устройство перезагружается на 1-8 секунд и меняет
   * активный workspace-файл.
   *
   * @param {'Mobile'|'Live'|'Prof'} mode
   * @param {{waitMs?: number}} [opts]
   */
  /**
   * Сменить режим устройства.
   *
   * ⚠️ ОПАСНАЯ ОПЕРАЦИЯ (проверено, research/NOTES.md §84).
   *
   * Правильный порядок:
   *   1. остановить M Control Center (иначе он конфликтует и состояние
   *      рассинхронизируется);
   *   2. отправить `0x11:0x1d` РОВНО ОДИН раз;
   *   3. подождать перезагрузку;
   *   4. ЗАПУСТИТЬ MCC обратно (он синхронизирует файл и устройство);
   *   5. проверить результат по HID-семействам, а не по файлу.
   *
   * @param {'Mobile'|'Live'|'Prof'} mode
   * @param {{waitMs?: number, mccFriendly?: boolean, verify?: boolean}} [opts]
   */
  async setMode(mode, opts = {}) {
    const MAP = { Mobile: 1, Live: 2, Prof: 3 };
    const value = MAP[mode];
    if (value === undefined) {
      throw new Error(`неизвестный режим: ${mode}; допустимо: ${Object.keys(MAP).join(', ')}`);
    }

    const waitMs = opts.waitMs ?? 16000;
    /**
     * mccFriendly — запускать ли MCC вокруг смены режима.
     *
     * ИСПРАВЛЕНО 2026-11-10: раньше по умолчанию было true, потому
     * что считалось, будто без MCC устройство остаётся в промежуточном
     * состоянии (NOTES §86).
     *
     * Проверено `prove-mode-change.js` при ПОЛНОСТЬЮ закрытом MCC:
     *
     *     ДО:    Live,  102 тега
     *     кадр:  0x11:0x1d = 3
     *     ПОСЛЕ: Prof,  202 тега
     *     устройство вернулось само, режим сменился корректно
     *
     * Значит MCC для смены режима НЕ нужен. По умолчанию теперь false.
     * Если MCC всё же запущен, его стоит закрыть перед сменой —
     * он может откатить запись.
     */
    const mccFriendly = opts.mccFriendly === true;
    const verify = opts.verify !== false;

    // 1) останавливаем MCC, если он запущен
    let mccWasRunning = false;
    // Флаг: не удалось запустить MCC после смены режима.
    // Важно для диагностики — без MCC устройство может остаться
    // в промежуточном состоянии (NOTES §86).
    let mccStartFailed = false;
    if (mccFriendly && process.platform === 'win32') {
      try {
        const { execFileSync } = await import('node:child_process');
        const cnt = execFileSync('powershell.exe', ['-NoProfile', '-Command',
          '(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'],
        { encoding: 'utf8' }).trim();
        mccWasRunning = Number(cnt) > 0;
        if (mccWasRunning) {
          this.log.info?.('[m62] останавливаю MCC перед сменой режима…');
          execFileSync('powershell.exe', ['-NoProfile', '-Command',
            'Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue'],
          { encoding: 'utf8' });
          await new Promise((r) => setTimeout(r, 4500));
        }
      } catch {
        /* MCC не мешает */
      }
    }

    // 2) отправляем кадр смены режима — РОВНО ОДИН раз.
    //    ВАЖНО: НЕ закрываем транспорт ДО отправки, иначе отправлять некуда
    //    (был баг: "устройство не открыто").
    if (!this.t.device) {
      try { await this.t.open(); } catch { /* попробуем отправить как есть */ }
    }
    this.t.send(0x11, 0x1d, value);
    this.log.info?.(`[m62] смена режима на ${mode}, жду перезагрузку…`);

    // 3) теперь можно отпустить HID — устройство перезагружается
    await new Promise((r) => setTimeout(r, 1500));
    try { this.t.close({ final: true }); } catch { /* */ }

    // 4) ждём и переоткрываем
    await new Promise((r) => setTimeout(r, waitMs));
    if (!this.t.device) {
      try { await this.t.open(); } catch { /* устройство ещё грузится */ }
    }

    // 5) MCC запускаем ТОЛЬКО если явно попросили (mccFriendly: true).
    //
    //    Проверено 2026-11-10 (`prove-mode-change.js`): без MCC
    //    устройство перезагружается и поднимается само, полный набор
    //    тегов приходит. Прежнее требование MCC было основано на
    //    наблюдении §86, которое не подтвердилось при чистом опыте.
    if (mccFriendly && process.platform === 'win32') {
      try {
        const { execFileSync } = await import('node:child_process');
        this.log.info?.('[m62] запускаю MCC для синхронизации…');
        execFileSync('powershell.exe', ['-NoProfile', '-Command',
          'Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"'],
        { encoding: 'utf8' });
        await new Promise((r) => setTimeout(r, 18000));
      } catch (err) {
        // Не глотаем: без MCC устройство может остаться в промежуточном
        // состоянии (NOTES §86), и пользователь должен об этом знать.
        this.log.warn?.(`[m62] не удалось запустить MCC: ${err?.message ?? err}`);
        mccStartFailed = true;
      }
    }

    // 6) проверяем результат по HID-семействам
    let detected = null;
    let consistent = null;
    if (verify) {
      try {
        await new Promise((r) => setTimeout(r, 3000));
        if (!this.t.device) await this.t.open();
        this.t.send(0x11, 0x26, 1);
        await new Promise((r) => setTimeout(r, 4000));
        const { detectModeFromHid, detectMode } = await import('./modes.js');
        const { findActiveWorkspace, readWorkspace, parseAll } = await import('./workspace.js');
        const snap = this.t.snapshot?.() ?? {};
        detected = detectModeFromHid(snap);
        const wsPath = findActiveWorkspace();
        if (wsPath) {
          const parsed = parseAll(readWorkspace(wsPath.path));
          const fromWs = detectMode({ mode: wsPath.mode, ...parsed });
          consistent = fromWs.mode === detected.mode;
        }
      } catch {
        /* проверка не критична */
      }
    }

    return {
      mode,
      value,
      reloaded: true,
      mccRestarted: mccWasRunning,
      mccStartFailed,
      detectedFromHid: detected?.mode ?? null,
      consistent,
      note: mccStartFailed
        ? `ВНИМАНИЕ: не удалось запустить MCC после смены режима — устройство может быть в промежуточном состоянии`
        : (detected && detected.mode !== mode
          ? `ВНИМАНИЕ: HID определяет режим как ${detected.mode}, а не ${mode}`
          : 'устройство перезагрузилось; активный workspace мог смениться'),
    };
  }

  /**
   * Выполнить команду.
   * @param {string} id
   * @param {{confirm?: boolean}} [opts]
   */
  runCommand(id, opts = {}) {
    const c = COMMANDS.find((x) => x.id === id);
    if (!c) throw new Error(`неизвестная команда: ${id}`);
    if (DESTRUCTIVE.has(id) && !opts.confirm) {
      throw new Error(
        `команда "${id}" необратима; передайте confirm: true для выполнения`,
      );
    }
    this.t.send(c.target, c.prop, 1);
    return { id, name: c.name, destructive: DESTRUCTIVE.has(id) };
  }

  /** Классифицировать входящее событие как настройку. */
  classify(ev) {
    const key = `${ev.target}:${ev.prop}`;
    const t = TOGGLES.find((x) => `${x.target}:${x.prop}` === key);
    if (t) {
      return {
        ...ev,
        kind: 'setting',
        id: t.id,
        name: t.name,
        label: t.values[ev.value] ?? null,
      };
    }
    const e = ENUMS.find((x) => `${x.target}:${x.prop}` === key);
    if (e) {
      return {
        ...ev,
        kind: 'setting',
        id: e.id,
        name: e.name,
        label: labelFor(e, ev.value),
      };
    }
    const s = STATUS.find((x) => `${x.target}:${x.prop}` === key);
    if (s) {
      return { ...ev, kind: 'status', id: s.id, name: s.name };
    }
    return null;
  }
}

export { findSetting };
