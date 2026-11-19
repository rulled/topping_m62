/**
 * HID-транспорт к TOPPING M62.
 *
 * Открывает interface 4 (vendor control channel), подписывается,
 * держит keepalive и раздаёт события.
 *
 * Interface 3 (DFU) не трогается никогда.
 */

import { EventEmitter } from 'node:events';
import HID from 'node-hid';

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
import { buildMixerPacket } from './mixer-tags.js';

export const VID = 0x152a;
export const PID = 0x875c;

/** interface 4 — vendor control channel. */
const VENDOR_INTERFACE = 4;

/**
 * Период повторного запроса полного состояния (0x11:0x26).
 *
 * Без него в Prof-режиме не приходят EQ входов (0x91..0x94) и
 * EQ наушников (0xa1..0xaa) — проверено test-long-session.js.
 */
const ANNOUNCE_MS = 15000;

/**
 * Сколько ждать ответ на handshake.
 *
 * Опубликованный драйвер ядра (`sound/usb/hid-topping.c`, патч 5/8):
 * карта отвечает за 8..851 мс. Announce длится 3,1-3,3 с, поэтому
 * 3,5 с — разумный предел: дольше ждать нечего.
 *
 * Значение то же, что в `transport-core.js` — это проверяет
 * `audit-transport-divergence.js`.
 */
const ANSWER_MS = 3500;

export class M62Transport extends EventEmitter {
  constructor({ logger = console } = {}) {
    super();
    this.log = logger;
    this.device = null;
    this.keepaliveTimer = null;
    this.readTimer = null;
    this.closing = false;
    /** Таймер автоматического переподключения. */
    this.reconnectTimer = null;
    /** Сколько попыток переподключения сделано подряд. */
    this.reconnectAttempts = 0;
    /** Последние известные значения: "TT:PP" -> value */
    this.cache = new Map();
    this.stats = { reads: 0, writes: 0, parseErrors: 0, idle: 0, started: null };
  }

  /** Находит HID-путь нашего устройства. */
  static find() {
    const all = HID.devices();
    const candidates = all.filter(
      (d) => d.vendorId === VID && d.productId === PID,
    );
    if (candidates.length === 0) return null;

    // Предпочитаем interface 4.
    const vendor = candidates.find(
      (d) => d.interface === VENDOR_INTERFACE,
    );
    const chosen = vendor ?? candidates[0];
    return {
      path: chosen.path,
      interface: chosen.interface,
      product: chosen.product,
      manufacturer: chosen.manufacturer,
      serialNumber: chosen.serialNumber,
      all: candidates.map((c) => ({ path: c.path, interface: c.interface })),
    };
  }

  /** Открывает устройство и подписывается. */
  async open() {    if (this.device) return;

    // Ручной open() снимает флаг окончательного закрытия и сбрасывает
    // счётчик попыток — иначе автовосстановление не заработает.
    this.closing = false;
    this.reconnectAttempts = 0;

    const info = M62Transport.find();
    if (!info) {
      throw new Error(
        `M62 не найден (VID 0x${VID.toString(16)} PID 0x${PID.toString(16)})`,
      );
    }

    this.log.info?.(
      `[m62] найден: iface=${info.interface} product=${info.product ?? '?'}`,
    );

    this.device = new HID.HID(info.path);
    this.closing = false;
    this.stats.started = new Date().toISOString();

    this.device.on('error', (err) => {
      // При отключении кабеля сюда приходят ENODEV/EPROTO — это норма.
      if (!this.closing) this.emit('error', err);
    });

    // ===== SESSION HANDSHAKE — ОБЯЗАТЕЛЕН ПЕРВЫМ =====
    // Без него карта молчит по части состояния: компрессор (0x46:0x01..08),
    // EQ-полосы (0x91..0x94) и переключатели (0x9b:0x0f/10/12/13)
    // не приходят вовсе. Проверено: 44 тега -> 96 тегов.
    // Источник: github.com/NTMan/topping-m62 (PROTOCOL.md).
    //
    // ═══ ВАЖНО: ЖДАТЬ ОТВЕТ, А НЕ ШЛАТЬ ПОДРЯД ═══
    //
    // Раньше здесь стояло три кадра подряд без паузы. Это работает
    // на нашей карте, но опубликованный драйвер ядра
    // (`sound/usb/hid-topping.c`, патч 5/8) предупреждает:
    //
    //   «Nothing follows the handshake until it is answered. The card
    //   answers 0x11/0x01 8 to 851 ms after it… a write that reached
    //   the card 2 ms before the answer was not applied.»
    //
    // То есть без ожидания часть записей теряется МОЛЧА. В
    // `transport-core.js` это уже исправлено, а здесь — нет:
    // расхождение нашёл `audit-transport-divergence.js`.
    //
    // Правильно: дождаться события handshake (или 3.5 с) и только
    // потом подписываться.
    //
    // ═══ ЛОВУШКА: ЧТЕНИЕ НАДО ЗАПУСТИТЬ ДО ОЖИДАНИЯ ═══
    //
    // Первая версия этой правки ставила ожидание ПЕРЕД #startReading(),
    // и `open()` зависал навсегда: ответ карты читать было некому,
    // промис никогда не разрешался.
    //
    // Чтение должно идти ДО отправки handshake — иначе ожидание
    // ответа превращается во взаимную блокировку.
    this.#startReading();

    const answered = this.#waitForHandshakeAnswer(ANSWER_MS);
    this.send(TT_DEVICE, PP_HANDSHAKE, 1);

    const gotAnswer = await answered;
    if (!gotAnswer) {
      // Не ошибка: карта могла быть занята announce. Продолжаем —
      // без подписки она всё равно замолчит.
      this.log.warn?.('[m62] карта не ответила на handshake за 3.5 с, продолжаю');
    }

    // Подписка: без неё устройство молчит.
    this.send(TT_DEVICE, PP_SUBSCRIBE, 1);
    // Запрос полного состояния.
    this.send(TT_DEVICE, PP_ANNOUNCE, 1);

    this.#startKeepalive();
    // ВТОРОЙ #startReading() здесь НЕ НУЖЕН: чтение уже запущено выше,
    // до ожидания handshake. Второй вызов создал бы два конкурирующих
    // цикла чтения — один терял бы отчёты, которые забрал другой.

    this.emit('open');
  }

  /**
   * Продление подписки + периодический запрос полного состояния.
   *
   * ═══ ПОЧЕМУ НУЖЕН ANNOUNCE ═══
   *
   * Подписка (0x11:0x24) обязательна каждые 2 с — иначе устройство
   * замолкает. Это было известно.
   *
   * Но оказалось, что ОДНОГО ANNOUNCE при открытии недостаточно:
   * в Prof-режиме блоки EQ (0x91..0x94) и EQ наушников (0xa1..0xaa)
   * приходят только через ~19 секунд после ПОВТОРНОГО ANNOUNCE.
   *
   * Проверено (test-long-session.js): одна долгая сессия,
   *   ANNOUNCE при открытии  -> 6 тегов
   *   ANNOUNCE на 16-й секунде -> 174 тега
   *   0x91 на 18.8 с, 0xa1 на 18.9 с
   *
   * Поэтому шлём ANNOUNCE периодически (каждые 15 с). Это не мешает
   * работе: устройство просто повторяет полный дамп.
   */
  /**
   * Дождаться ответа на handshake.
   *
   * Карта отвечает кадром `TT_DEVICE:PP_HANDSHAKE`. Пока ответа нет,
   * ничего слать нельзя — иначе часть записей теряется (см. комментарий
   * в open()).
   *
   * Возвращает промис, который разрешается `true` при ответе или
   * `false` по таймауту. Не бросает: отсутствие ответа не фатально.
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
        this.off('event', onEvent);
        resolve(ok);
      };
      const onEvent = (ev) => {
        if (ev.target === TT_DEVICE && ev.prop === PP_HANDSHAKE) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      // unref: таймер не должен держать процесс живым.
      timer.unref?.();
      this.on('event', onEvent);
    });
  }

  #startKeepalive() {
    this.#stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      try {
        this.send(TT_DEVICE, PP_SUBSCRIBE, 1);
      } catch (err) {
        this.emit('error', err);
      }
    }, KEEPALIVE_MS);
    this.keepaliveTimer.unref?.();

    // Периодический запрос полного дампа — без него EQ (0x91..0x94)
    // и EQ наушников (0xa1..0xaa) в Prof-режиме не приходят вовсе.
    this.announceTimer = setInterval(() => {
      try {
        this.send(TT_DEVICE, PP_ANNOUNCE, 1);
      } catch {
        /* тихо: устройство могло отключиться, этим займётся reconnect */
      }
    }, ANNOUNCE_MS);
    this.announceTimer.unref?.();
  }

  #stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
  }

  /**
   * Чтение нотификаций.
   *
   * ВАЖНО (замерено `src/tools/diag-read.js`):
   * наивный вариант «одно чтение за тик setTimeout(tick, 0)» даёт всего
   * ~65 отчётов в секунду, а устройство шлёт сотни. Из-за этого терялась
   * БОЛЬШАЯ ЧАСТЬ состояния: приходило 2 тега настроек из 8 вместо всех 8.
   *
   * Поэтому: внутри одного тика вычитываем пачку — пока данные идут,
   * не отдавая управление event loop. Так счётчик чтений вырастает
   * с ~260 до ~2400 за 4 секунды и приходит полный набор тегов.
   */
  #startReading() {
    const BATCH = 64;        // столько отчётов максимум за один тик
    const tick = () => {
      if (this.closing || !this.device) return;
      for (let i = 0; i < BATCH; i++) {
        let data = null;
        try {
          // короткий таймаут: если данных нет — сразу выходим из пачки
          data = this.device.readTimeout(5);
        } catch (err) {
          if (!this.closing) {
            this.emit('error', err);
            // Кабель выдернули (ENODEV) или устройство ушло — закрываемся
            // и планируем автовосстановление (NOTES §58).
            const code = err?.code ?? err?.errno;
            const fatal = ['ENODEV', 'ESHUTDOWN', 'EPROTO', 'EIO'].includes(code)
              || /could not read|hid_read_timeout/i.test(String(err?.message ?? ''));
            if (fatal) {
              try { this.device?.close(); } catch { /* уже */ }
              this.device = null;
              if (!this.closing) this.#scheduleAutoReconnect();
            }
          }
          return;
        }
        if (!data || !data.length) break;
        this.#handleReport(data);
      }
      // Отдать управление event loop и продолжить.
      this.readTimer = setTimeout(tick, 0);
      this.readTimer.unref?.();
    };
    this.readTimer = setTimeout(tick, 0);
    this.readTimer.unref?.();
  }

  #handleReport(raw) {
    this.stats.reads++;
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
      // Устройство CRC проверяет? Нет — но мы валидируем.
      this.emit('badcrc', msg);
      return;
    }
    if (msg.target === 0 && msg.prop === 0 && msg.value === 0) {
      this.stats.idle++;
      return;
    }

    const key = `${msg.target}:${msg.prop}`;
    const prev = this.cache.get(key);
    this.cache.set(key, msg.value);

    this.emit('event', {
      target: msg.target,
      prop: msg.prop,
      value: msg.value,
      key,
      changed: prev !== msg.value,
      previous: prev ?? null,
      at: new Date().toISOString(),
    });
  }

  /**
   * Отправляет кадр.
   * @param {number} target
   * @param {number} prop
   * @param {number} value
   * @param {boolean} [withCrc=true]
   */
  send(target, prop, value, withCrc = true) {
    if (!this.device) throw new Error('устройство не открыто');
    const frame = buildFrame(target, prop, value, withCrc);
    if (frame.length !== FRAME_LEN) throw new Error('плохой кадр');
    const buf = withReportId(frame);
    this.device.write([...buf]);
    this.stats.writes++;
  }

  /** Последнее известное значение. */
  get(target, prop) {
    return this.cache.get(`${target}:${prop}`) ?? null;
  }

  /**
   * Записать матрицу микшера.
   *
   * ═══ КАК ЭТО РАБОТАЕТ ═══
   *
   * Микшер НЕ пишется одиночными кадрами — проверено, устройство их
   * игнорирует. Он передаётся ПАКЕТОМ между скобками bulk push:
   *
   *     0x11:0x20 = 1     открыть
   *     ... 200 кадров в строгом порядке MCC ...
   *     0x11:0x20 = 0     закрыть
   *     0x11:0x26 = 1     запросить дамп обратно
   *
   * Порядок кадров критичен: проверено сравнением с захватом MCC,
   * размер и все 200 адресов совпадают (см. docs/MIXER.md).
   *
   * ═══ ВНИМАНИЕ: MCC ПЕРЕЗАПИШЕТ ═══
   *
   * MCC при старте берёт микшер из своего workspace-INI и отправляет
   * СВОЮ матрицу. Так что при работающем MCC запись будет откачена.
   * Храните состояние микшера у себя.
   *
   * @param {Record<string, Record<string, number>>} state
   *        { busName: { sourceName: db } }, busName из 'a'..'e',
   *        sourceName из MIXER_SOURCES (pb12, in1, aux, bt, ...)
   * @param {{announce?: boolean}} [opts]
   */
  writeMixer(state, opts = {}) {
    const packet = buildMixerPacket(state);

    this.send(0x11, PP_BULK_BEGIN, 1);
    for (const f of packet) {
      this.send(f.target, f.prop, f.value);
    }
    this.send(0x11, PP_BULK_BEGIN, 0);
    if (opts.announce !== false) {
      this.send(0x11, PP_ANNOUNCE, 1);
    }

    this.log.info?.(`[mixer] записано ${packet.length} кадров`);
    return { frames: packet.length };
  }

  /**
   * Снимок кеша.
   *
   * ВНИМАНИЕ: ключи здесь — `${target}:${prop}` в ДЕСЯТИЧНОЙ системе
   * (например "145:3" для 0x91:0x03). Многие модули ждут hex.
   * `src/eq-hid.js` и `src/comp-hid.js` понимают оба формата.
   */
  snapshot() {
    return Object.fromEntries(this.cache);
  }

  /**
   * Записать набор кадров в одном bulk-push брекете.
   *
   * Брекет нужен микшеру (без него одиночные записи игнорируются)
   * и безопасен для остального. После закрытия брекета шлётся
   * announce, чтобы устройство отдало состояние заново.
   *
   * @param {Array<{target:number, prop:number, value:number}>} frames
   * @param {{announce?: boolean}} [opts]
   */
  writeBulk(frames, opts = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('writeBulk: пустой набор кадров');
    }
    this.send(0x11, PP_BULK_BEGIN, 1);
    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      if (opts.updateCache !== false) {
        this.cache.set(`${f.target}:${f.prop}`, f.value);
      }
    }
    this.send(0x11, PP_BULK_BEGIN, 0);
    if (opts.announce !== false) {
      this.send(0x11, PP_ANNOUNCE, 1);
    }
    this.log.info?.(`[bulk] записано ${frames.length} кадров`);
    return { frames: frames.length };
  }

  /**
   * Записать кадры одиночными посылками, без брекета.
   *
   * Для EQ входов, компрессора и реверба брекет НЕ обязателен —
   * проверено 2026-11-10: всё пишется прямой записью.
   *
   * ВАЖНО: после записи кеш обновляется вручную.
   *
   * Почему: устройство не подтверждает запись событием, а следующий
   * ANNOUNCE приходит не сразу (и в случае EQ — только раз в сессию).
   * Без обновления кеша второй же вызов читает СТАРОЕ значение и
   * принимает неверное решение: например, «реверб в Bypass, менять
   * параметры нельзя», хотя тип только что включён.
   *
   * Устройство всё равно остаётся источником истины: когда придёт
   * настоящее событие, оно перезапишет кеш своим значением.
   *
   * @param {Array<{target:number, prop:number, value:number}>} frames
   * @param {{viaBracket?: boolean, announce?: boolean, updateCache?: boolean}} [opts]
   */
  writeFrames(frames, opts = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('writeFrames: пустой набор кадров');
    }
    if (opts.viaBracket) {
      return this.writeBulk(frames, opts);
    }
    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      // оптимистично обновляем кеш
      if (opts.updateCache !== false) {
        this.cache.set(`${f.target}:${f.prop}`, f.value);
      }
    }
    if (opts.announce !== false) {
      this.send(0x11, PP_ANNOUNCE, 1);
    }
    this.log.info?.(`[write] записано ${frames.length} кадров`);
    return { frames: frames.length };
  }

  /**
   * ЗАПИСЬ EQ С ПРАВИЛЬНЫМ КОММИТОМ (открытие 2026-11-13).
   *
   * ═══ В ЧЁМ БЫЛА ПРОБЛЕМА ═══
   *
   * Девять проверок «запись EQ не работает» ошибались по ДВУМ причинам:
   *
   *  1. Сессия обрывалась сразу после записи. Прошивка коммитит
   *     live-состояние НЕ МГНОВЕННО: если закрыть HID сразу, запись
   *     теряется. Замерено: 0.5/1/1.5 с — теряется;
   *     2 с и больше — применяется.
   *
   *  2. Читали обычным ANNOUNCE. Блоки EQ (0x91..0x94, 0xa1..0xaa)
   *     приходят ТОЛЬКО в ответ на 0x11:26 (дамп DSP-блоков),
   *     который завершается 0x11:25 через ~2.7-3.0 с.
   *
   * ═══ ПРОВЕРЕНО ═══
   *
   *   hold 2.0 с  gain=5  -> дамп показывает 5   ПРИМЕНЕНО
   *   hold 2.5 с  gain=6  -> дамп показывает 6   ПРИМЕНЕНО
   *   hold 3/6/10/15 с    -> все применены
   *   hold 0.5/1/1.5 с    -> потеряно
   *
   * ═══ ВАЖНОЕ УТОЧНЕНИЕ ═══
   *
   * Держать `holdMs` НЕДОСТАТОЧНО. После hold нужна ещё пауза
   * ~4 с (`settleMs`), прежде чем закрывать сессию — иначе запись
   * теряется. Это выяснилось на 5 свойствах × IN1/IN2
   * (`prove-eq-in2-live.js`): пока тест читал через `readViaDump()`
   * (он сам ждёт 3.5 с), всё проходило; как только чтение убрали,
   * провалились 5 из 5 при формально правильных кадрах.
   *
   * ═══ ЧТО ДЕЛАЕТ ЭТОТ МЕТОД ═══
   *
   * Пишет кадры, держит сессию открытой `holdMs` (по умолчанию 2500),
   * даёт прошивке `settleMs` (по умолчанию 4000) и только потом
   * возвращает управление — закрывать сессию можно сразу после.
   *
   * @param {Array<{target:number, prop:number, value:number}>} frames
   * @param {{holdMs?: number, settleMs?: number, readBack?: boolean}} [opts]
   */
  async writeEqWithCommit(frames, opts = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('writeEqWithCommit: пустой набор кадров');
    }
    const holdMs = Math.max(2000, opts.holdMs ?? 2500);
    const settleMs = Math.max(0, opts.settleMs ?? 4000);

    for (const f of frames) {
      this.send(f.target, f.prop, f.value);
      if (opts.updateCache !== false) {
        this.cache.set(`${f.target}:${f.prop}`, f.value);
      }
    }

    // Держим сессию живой: без этого прошивка не коммитит.
    await new Promise((r) => setTimeout(r, holdMs));

    // Запрашиваем дамп — только так приходят блоки EQ.
    this.send(0x11, PP_ANNOUNCE, 1);

    // И даём прошивке дописать live-состояние до закрытия сессии.
    if (settleMs) await new Promise((r) => setTimeout(r, settleMs));

    return { frames: frames.length, holdMs, settleMs };
  }

  /**
   * Прочитать состояние ЧЕРЕЗ ДАМП (единственный способ для EQ).
   *
   * Шлёт 0x11:26, ждёт терминатор 0x11:25 (примерно 2.7-3.0 с),
   * собирает всё, что пришло. Возвращает снимок в том же формате,
   * что `snapshot()`, плюс отметку о терминаторе.
   *
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<Record<string, number>>}
   */
  async readViaDump(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 12000;

    // ═══ ЧЕСТНАЯ ЛОГИКА (исправлено 2026-11-14) ═══
    //
    // ГЛАВНОЕ ПРАВИЛО КАРТЫ, доказанное `prove-announce-eq-rule.js`:
    // блоки EQ (0x91..0x94) приходят ТОЛЬКО на ПЕРВЫЙ announce в
    // НОВОЙ сессии. Повторный announce в той же сессии даёт 48
    // адресов вместо 91 и НОЛЬ EQ-адресов (было 40).
    //
    //     announce #1: 91 адрес, 40 EQ
    //     announce #2: 48 адресов, 0 EQ
    //     announce #3: 48 адресов, 0 EQ
    //     новая сессия, #1: 91 адрес, 40 EQ
    //
    // Значит повторный announce НЕ обновляет EQ. Функция вернёт
    // то, что лежит в кеше, а туда `writeEqWithCommit` положил наши
    // значения. Это давало ложное «ПРИМЕНЕНО».
    //
    // Теперь возвращаемые значения помечаются: если EQ повторно не
    // пришли, ставится __fromCache и __dumpComplete = false.
    const eqKey = (k) => /^(145|146|147|148|161|162|163|164|165|166|167|168|169|170):/.test(k);
    const before = [...this.cache.keys()].filter(eqKey).length;

    this.cache.delete('17:37');
    this.send(0x11, PP_ANNOUNCE, 1);
    await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 3500)));

    const snap = this.snapshot();
    const after = Object.keys(snap).filter(eqKey).length;
    const sawTerminator = this.cache.get('17:37') === 1;
    const fromCache = after <= before && before > 0;

    snap.__dumpComplete = sawTerminator && !fromCache;
    snap.__fromCache = fromCache;
    snap.__eqCount = after;
    snap.__terminatorSeen = sawTerminator;
    return snap;
  }

  /**
   * ПРОЧИТАТЬ ПРАВДУ: закрыть сессию и открыть НОВУЮ.
   *
   * ═══ ЗАЧЕМ ЭТО ОТДЕЛЬНЫЙ МЕТОД ═══
   *
   * EQ-блоки (0x91..0x94, 0xa1..0xaa) приходят ТОЛЬКО на ПЕРВЫЙ
   * announce НОВОЙ сессии (`prove-announce-eq-rule`: announce#1 =
   * 40 EQ-адресов, announce#2 и #3 = 0, новая сессия = 40 снова).
   *
   * Значит `readViaDump()` в той же сессии физически не может
   * вернуть свежий EQ — он вернёт то, что уже лежит в кеше, включая
   * значения, которые мы сами туда записали. Это и давало ложное
   * «ПРИМЕНЕНО». Единственный честный способ — новая сессия.
   *
   * ═══ ОСТОРОЖНО С АВТОРЕКОННЕКТОМ ═══
   *
   * Обычный `close()` планирует автопереподключение по таймеру.
   * Здесь это недопустимо: таймер откроет устройство параллельно
   * с нашим и второй писатель будет конфликтовать. Поэтому сначала
   * ставим `closing`, затем закрываем «навсегда».
   *
   * @param {{waitMs?:number}} [opts] waitMs — сколько ждать первый announce
   * @returns {Promise<Record<string,number>|null>} null — переоткрыть не удалось
   */
  async readFresh(opts = {}) {
    const waitMs = opts.waitMs ?? 7000;

    // Замораживаем всё, что может помешать: keepalive, announce, чтение
    // и — главное — автопереподключение.
    this.closing = true;
    this.#stopKeepalive();
    this.#stopAutoReconnect();
    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }

    const old = this.device;
    this.device = null;
    if (old) {
      try {
        old.close();
      } catch {
        /* уже закрыто */
      }
    }
    this.stats.reads = 0;
    this.stats.parseErrors = 0;

    // Новая сессия: open() сам снимает closing и делает handshake.
    try {
      await this.open();
    } catch (err) {
      this.log.warn?.(`[m62] readFresh: переоткрыть не удалось: ${err?.message ?? err}`);
      return null;
    }

    // Первый announce новой сессии несёт EQ. Ждём его.
    await new Promise((r) => setTimeout(r, waitMs));

    return this.snapshot();
  }

  /**
   * Закрыть устройство.
   * @param {{final?: boolean}} [opts] final=true — не пытаться переподключаться
   */
  close(opts = {}) {
    if (opts.final) this.closing = true;
    this.#stopKeepalive();
    this.#stopAutoReconnect();
    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }
    if (this.device) {
      try {
        this.device.close();
      } catch {
        /* уже закрыто */
      }
      this.device = null;
    }
    this.emit('close');

    // Автовосстановление: если закрылись не по команде «навсегда»,
    // пробуем переоткрыть устройство.
    if (!opts.final && !this.closing) this.#scheduleAutoReconnect();
  }

  /**
   * Запланировать автоматическое переподключение.
   *
   * ЗАЧЕМ (проверено research/NOTES.md §58): при выдёргивании кабеля
   * бекенд оставался мёртвым до ручного /api/connect. Пользователь
   * воткнул кабель обратно — а клиент не работает.
   *
   * Интервал растёт: 1 с, 2 с, 4 с, ... до 10 с максимум.
   */
  #scheduleAutoReconnect() {
    if (this.reconnectTimer || this.reconnectAttempts >= 30) return;
    this.#stopAutoReconnect();

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closing) return;
      try {
        await this.open();
        this.reconnectAttempts = 0;
        this.emit('reconnected');
      } catch {
        this.#scheduleAutoReconnect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #stopAutoReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

