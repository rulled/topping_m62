/**
 * ЯДРО ТРАНСПОРТА M62 — БЕЗ ЗАВИСИМОСТИ ОТ СРЕДЫ.
 *
 * ═══ ЗАЧЕМ ЭТОТ ФАЙЛ ═══
 *
 * `transport.js` смешивал две разные вещи:
 *
 *   1. ПОЛИТИКУ — handshake, подписка, keepalive, батчи чтения,
 *      кеш значений, реконнект. Она одинакова везде.
 *   2. ВВОД-ВЫВОД — `node-hid` в Node, `navigator.hid` в браузере.
 *
 * Из-за этого протокол нельзя было переиспользовать на клиенте, и
 * весь веб-клиент требовал локального сервера.
 *
 * Здесь осталась только ПОЛИТИКА. Устройство приходит снаружи как
 * адаптер с двумя методами:
 *
 *     adapter.write(bytes: Uint8Array): Promise<void> | void
 *     adapter.onData(cb: (report: Uint8Array) => void): void
 *     adapter.close(): void
 *
 * ═══ ЧТО ДОЛЖЕН ДЕЛАТЬ АДАПТЕР ═══
 *
 * Отдавать сырые отчёты КАК ЕСТЬ — с report ID или без, как их
 * вернула среда. `parseReport()` сам отбрасывает ведущий нулевой
 * байт, если кадр сдвинут.
 *
 * ═══ ЧТО ЗДЕСЬ ВАЖНО НЕ СЛОМАТЬ ═══
 *
 * • handshake 0x11:0x01 ОБЯЗАТЕЛЕН и первым — без него карта молчит
 *   по части состояния (44 тега вместо 96).
 * • keepalive 0x11:0x24 каждые 2 с — иначе карта замолкает.
 * • announce 0x11:0x26 каждые 15 с — без него EQ-блоки не приходят.
 * • запись EQ требует удержания сессии ≥ 2 с (см. writeEqWithCommit).
 */

import {
  FRAME_LEN,
  KEEPALIVE_MS,
  PP_ANNOUNCE,
  PP_BULK_BEGIN,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  TT_DEVICE,
  buildFrame,
  isIdle,
  parseReport,
  withReportId,
} from './protocol.js';

/** Период повтора announce (полный дамп состояния). */
export const ANNOUNCE_MS = 15000;

/** Ключ терминатора дампа DSP-блоков (0x11:0x25). */
const TERMINATOR_KEY = '17:37';

/**
 * Адаптер среды: то немногое, что зависит от Node или браузера.
 *
 * `reopen` НЕОБЯЗАТЕЛЕН намеренно: `readFresh()` умеет подтверждать
 * запись только новой сессией, а для этого адаптер должен закрыться и
 * открыться заново. Не всякий адаптер это умеет (в браузере — повторный
 * `device.open()`), поэтому отсутствие `reopen` — штатная ситуация:
 * `readFresh()` проверяет его наличие и честно возвращает null.
 *
 * @typedef {object} TransportAdapter
 * @property {(report: Uint8Array|number[]) => (Promise<void>|void)} write
 * @property {(cb: (data: Uint8Array) => void) => (Promise<void>|void)} onData
 * @property {() => (Promise<void>|void)} [close]
 * @property {() => (Promise<unknown>|void)} [reopen]
 */

/**
 * Логгер: любой объект с необязательными методами.
 *
 * Именно необязательными — в скриптах часто передают `{ warn(){} }`
 * без `info`/`error`, и это нормально: вызовы идут через `?.`.
 *
 * @typedef {object} TransportLogger
 * @property {(...a: any[]) => void} [info]
 * @property {(...a: any[]) => void} [warn]
 * @property {(...a: any[]) => void} [error]
 */

/**
 * Транспорт, не зависящий от среды.
 *
 * Наследует Map-подобный кеш и события через простой эмиттер,
 * чтобы работал и в Node, и в браузере.
 */
export class M62TransportCore {
  /**
   * @param {{adapter?: TransportAdapter, logger?: TransportLogger}} [opts]
   *        `adapter` объявлен необязательным только чтобы можно было
   *        вызвать конструктор без аргументов и получить внятную
   *        ошибку ниже, а не падение деструктуризации.
   */
  constructor({ adapter, logger = console } = {}) {
    if (!adapter) throw new Error('M62TransportCore: нужен adapter');
    this.adapter = adapter;
    this.log = logger;

    /** "TT:PP" (в десятичной) -> последнее значение */
    this.cache = new Map();
    /** Подписчики событий: имя -> Set<fn> */
    this.listeners = new Map();

    this.keepaliveTimer = null;
    this.announceTimer = null;
    this.closing = false;
    this.opened = false;

    this.stats = {
      reads: 0,
      writes: 0,
      parseErrors: 0,
      idle: 0,
      started: null,
    };

    adapter.onData((report) => this.#handleReport(report));
  }

  // ─── события (крошечный эмиттер, чтобы не тянуть node:events) ───

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        this.log.error?.('[m62] обработчик упал:', err);
      }
    }
  }

  // ─── отправка ───

  /**
   * Отправить 15-байтовый кадр.
   * @param {number} target
   * @param {number} prop
   * @param {number} value
   */
  send(target, prop, value) {
    const frame = withReportId(buildFrame(target, prop, value, true));
    this.stats.writes++;
    this.adapter.write(frame);
  }

  /** Отправить уже собранный 15-байтовый кадр. */
  sendFrame(frame) {
    this.stats.writes++;
    this.adapter.write(withReportId(frame));
  }

  // ─── жизненный цикл ───

  /**
   * Открыть сессию.
   *
   * ═══ ПОРЯДОК И ОЖИДАНИЕ ═══
   *
   * handshake -> ДОЖДАТЬСЯ ОТВЕТА -> subscribe -> announce.
   *
   * Раньше здесь стояла фиксированная пауза 400 мс. Наша карта
   * отвечает за 44-92 мс, так что обычно хватало. Но опубликованный
   * драйвер ядра (`sound/usb/hid-topping.c`, патч 5/8) предупреждает:
   * карта отвечает за 8..851 мс, и «запись, дошедшая за 2 мс до
   * ответа, НЕ применялась, тогда как остальные применились».
   *
   * То есть 400 мс — лотерея: при медленном ответе часть записей
   * теряется молча. Поэтому ждём СОБЫТИЕ, а не время, с отсечкой
   * по 3.5 с (столько длятся announce; дольше ждать бессмысленно).
   *
   * Проверено на карте: ответ приходит 44-92 мс, тегов 91-92.
   */
  async open() {
    if (this.opened) return;
    this.closing = false;
    this.opened = true;
    this.stats.started = new Date().toISOString();

    // Ждём ответ на handshake: обещание разрешается в #handleReport,
    // когда придёт кадр TT_DEVICE:PP_HANDSHAKE.
    const answered = this.#waitForHandshakeAnswer(3500);

    this.send(TT_DEVICE, PP_HANDSHAKE, 1);

    const gotAnswer = await answered;
    if (!gotAnswer) {
      // Не ошибка: карта могла быть занята announce. Продолжаем —
      // без подписки она всё равно замолчит.
      this.log.warn?.(
        '[m62] карта не ответила на handshake за 3.5 с, продолжаю',
      );
    }

    this.send(TT_DEVICE, PP_SUBSCRIBE, 1);
    await sleep(250);
    this.send(TT_DEVICE, PP_ANNOUNCE, 1);

    this.#startTimers();
    this.emit('open');
  }

  /**
   * Дождаться ответа на handshake.
   *
   * Возвращает промис, который разрешается `true`, когда придёт
   * кадр `TT_DEVICE:PP_HANDSHAKE`, или `false` по таймауту.
   *
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  #waitForHandshakeAnswer(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.off?.('change', onChange);
        resolve(ok);
      };
      const onChange = (ev) => {
        if (ev.target === TT_DEVICE && ev.prop === PP_HANDSHAKE) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.on('change', onChange);
    });
  }

  #startTimers() {
    this.#stopTimers();
    this.keepaliveTimer = setInterval(() => {
      try {
        this.send(TT_DEVICE, PP_SUBSCRIBE, 1);
      } catch (err) {
        this.emit('error', err);
      }
    }, KEEPALIVE_MS);

    this.announceTimer = setInterval(() => {
      try {
        this.send(TT_DEVICE, PP_ANNOUNCE, 1);
      } catch {
        /* карта могла отключиться — этим займётся UI */
      }
    }, ANNOUNCE_MS);
  }

  #stopTimers() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
  }

  close() {
    this.closing = true;
    this.opened = false;
    this.#stopTimers();
    try {
      this.adapter.close?.();
    } catch {
      /* уже закрыто */
    }
    this.emit('close');
  }

  // ─── чтение ───

  #handleReport(raw) {
    this.stats.reads++;
    if (!raw || !raw.length) return;
    if (isIdle(raw)) {
      this.stats.idle++;
      return;
    }
    const msg = parseReport(raw);
    if (!msg) {
      this.stats.parseErrors++;
      this.emit('unknown', raw);
      return;
    }
    if (!msg.crcOk) {
      this.emit('badcrc', msg);
      return;
    }

    const key = `${msg.target}:${msg.prop}`;
    const prev = this.cache.get(key);
    this.cache.set(key, msg.value);

    if (prev !== msg.value) {
      this.emit('change', {
        target: msg.target,
        prop: msg.prop,
        value: msg.value,
        previous: prev,
        key,
      });
    }
    this.emit('report', msg);
  }

  /** Снимок кеша: "TT:PP" -> value (ключи в десятичной). */
  snapshot() {
    return Object.fromEntries(this.cache);
  }

  /** Значение по адресу или null. */
  get(target, prop) {
    return this.cache.has(`${target}:${prop}`)
      ? this.cache.get(`${target}:${prop}`)
      : null;
  }

  // ─── запись ───

  /**
   * Записать кадры одиночными посылками.
   *
   * @param {Array<{target:number,prop:number,value:number}>} frames
   * @param {{updateCache?:boolean, announce?:boolean}} [opts]
   */
  writeFrames(frames, opts = {}) {
    if (!Array.isArray(frames) || !frames.length) {
      throw new Error('writeFrames: пустой набор кадров');
    }
    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      if (opts.updateCache !== false) {
        this.cache.set(`${f.target}:${f.prop}`, f.value);
      }
    }
    if (opts.announce !== false) this.send(TT_DEVICE, PP_ANNOUNCE, 1);
    return { frames: frames.length };
  }

  /**
   * Записать кадры в bulk-push брекете (нужно микшеру).
   *
   * @param {Array<{target:number,prop:number,value:number}>} frames
   * @param {{updateCache?:boolean, announce?:boolean}} [opts]
   */
  writeBulk(frames, opts = {}) {
    if (!Array.isArray(frames) || !frames.length) {
      throw new Error('writeBulk: пустой набор кадров');
    }
    this.send(TT_DEVICE, PP_BULK_BEGIN, 1);
    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      if (opts.updateCache !== false) {
        this.cache.set(`${f.target}:${f.prop}`, f.value);
      }
    }
    this.send(TT_DEVICE, PP_BULK_BEGIN, 0);
    if (opts.announce !== false) this.send(TT_DEVICE, PP_ANNOUNCE, 1);
    return { frames: frames.length };
  }

  /**
   * ЗАПИСЬ EQ С КОММИТОМ.
   *
   * Прошивка коммитит live-состояние НЕ МГНОВЕННО. Замерено
   * (`prove-eq-in2-live.js`, 5 свойств × IN1/IN2 — 5/5):
   *
   *   1. держать сессию < 2 с после кадра — запись теряется,
   *      >= 2 с — применяется;
   *   2. ПОСЛЕ этого нужна ещё пауза ~4 с, прежде чем закрывать
   *      сессию. Иначе запись тоже теряется.
   *
   * Второй пункт раньше был неявным: тест читал через
   * `readViaDump()`, который сам ждёт 3.5 с, и «случайно» давал
   * нужную задержку. Как только чтение убрали, 5 из 5 проверок
   * стали проваливаться при формально правильных кадрах.
   *
   * Поэтому метод сам выдерживает и hold, и settle — вызывающему
   * достаточно дождаться промиса и только потом закрывать сессию.
   *
   * @param {Array<{target:number,prop:number,value:number}>} frames
   * @param {{holdMs?:number, settleMs?:number, announce?:boolean}} [opts]
   */
  async writeEqWithCommit(frames, opts = {}) {
    if (!Array.isArray(frames) || !frames.length) {
      throw new Error('writeEqWithCommit: пустой набор кадров');
    }
    const holdMs = Math.max(2000, opts.holdMs ?? 2500);
    const settleMs = Math.max(0, opts.settleMs ?? 4000);
    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      this.cache.set(`${f.target}:${f.prop}`, f.value);
    }
    // Держим сессию живой — иначе карта не закоммитит.
    await sleep(holdMs);
    if (opts.announce !== false) this.send(TT_DEVICE, PP_ANNOUNCE, 1);
    // И даём прошивке дописать live-состояние до закрытия сессии.
    if (settleMs) await sleep(settleMs);
    return { frames: frames.length, holdMs, settleMs };
  }

  /**
   * ПРОЧИТАТЬ ПРАВДУ: закрыть сессию, открыть новую, дождаться
   * первого announce.
   *
   * Это ЕДИНСТВЕННЫЙ способ подтвердить запись EQ: повторный
   * announce в той же сессии EQ не возвращает (см. readViaDump).
   *
   * ⚠ Адаптер должен уметь закрыться и открыться заново. В браузере
   * это означает повторный `device.open()`; в Node — новый HID.
   * Если адаптер такое не умеет, метод честно вернёт null.
   *
   * @param {{waitMs?:number}} [opts]
   * @returns {Promise<Record<string,number>|null>}
   */
  async readFresh(opts = {}) {
    if (typeof this.adapter.reopen !== 'function') {
      this.log.warn?.(
        '[m62] readFresh недоступен: адаптер не умеет reopen(). '
        + 'Подтвердить запись EQ можно только новой сессией.',
      );
      return null;
    }
    const waitMs = opts.waitMs ?? 7000;
    this.#stopTimers();
    try {
      this.adapter.close?.();
    } catch {
      /* уже */
    }
    await sleep(1200);
    await this.adapter.reopen();
    this.opened = false;
    await this.open();
    await sleep(waitMs);
    const snap = this.snapshot();
    snap.__fresh = true;
    return snap;
  }

  /**
   * Прочитать состояние ЧЕРЕЗ ДАМП.
   *
   * ═══ ГЛАВНОЕ ПРАВИЛО КАРТЫ (доказано 2026-11-14) ═══
   *
   * Блоки EQ (0x91..0x94, 0xa1..0xaa) приходят ТОЛЬКО на ПЕРВЫЙ
   * announce в НОВОЙ сессии. Повторный announce в той же сессии
   * возвращает 48 адресов вместо 91 и НОЛЬ EQ-адресов (было 40).
   *
   * Проверено (`prove-announce-eq-rule.js`, одна сессия):
   *
   *     announce #1: 91 адрес, 40 EQ
   *     announce #2: 48 адресов, 0 EQ
   *     announce #3: 48 адресов, 0 EQ
   *     новая сессия, #1: 91 адрес, 40 EQ
   *
   * ═══ ПОЧЕМУ ЭТО ВАЖНО ДЛЯ ЭТОЙ ФУНКЦИИ ═══
   *
   * Раньше здесь просто шёл announce в текущей сессии и возвращался
   * `snapshot()` — то есть КЕШ. Так как повторный announce ничего не
   * возвращает, функция отдавала значения, которые мы сами записали
   * оптимистично. Это давало ложное «ПРИМЕНЕНО».
   *
   * Теперь функция ЧЕСТНАЯ:
   *   • помечает возвращённые значения как `__fromCache: true`,
   *     если EQ-блоки в этой сессии не пришли повторно;
   *   • `__dumpComplete` больше не выдаётся за подтверждение.
   *
   * ДЛЯ ПОДТВЕРЖДЕНИЯ ЗАПИСИ НУЖНА НОВАЯ СЕССИЯ — см. `readFresh()`.
   *
   * @param {{timeoutMs?:number}} [opts]
   */
  async readViaDump(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 3500;

    const eqKey = (k) => /^(145|146|147|148|161|162|163|164|165|166|167|168|169|170):/.test(k);
    const before = Object.keys(this.snapshot()).filter(eqKey).length;

    this.cache.delete(TERMINATOR_KEY);
    this.send(TT_DEVICE, PP_ANNOUNCE, 1);
    await sleep(Math.min(timeoutMs, 3500));

    const snap = this.snapshot();
    const after = Object.keys(snap).filter(eqKey).length;

    const sawTerminator = this.cache.get(TERMINATOR_KEY) === 1;
    // EQ повторно не пришли -> значения в снимке из кеша
    const fromCache = after <= before && before > 0;

    snap.__dumpComplete = sawTerminator && !fromCache;
    snap.__fromCache = fromCache;
    snap.__eqCount = after;
    return snap;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { FRAME_LEN };
