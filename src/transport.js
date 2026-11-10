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
  async open() {
    if (this.device) return;

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
    this.send(TT_DEVICE, PP_HANDSHAKE, 1);

    // Подписка: без неё устройство молчит.
    this.send(TT_DEVICE, PP_SUBSCRIBE, 1);
    // Запрос полного состояния.
    this.send(TT_DEVICE, PP_ANNOUNCE, 1);

    this.#startKeepalive();
    this.#startReading();

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
      } catch (err) {
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
   * Для EQ входов и компрессора брекет НЕ обязателен — проверено
   * 2026-11-10: и то и другое пишется прямой записью. Брекет оставлен
   * как опция (`viaBracket`), потому что для некоторых полей он может
   * понадобиться; по умолчанию путь без него.
   *
   * @param {Array<{target:number, prop:number, value:number}>} frames
   * @param {{viaBracket?: boolean, announce?: boolean}} [opts]
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
    }
    if (opts.announce !== false) {
      this.send(0x11, PP_ANNOUNCE, 1);
    }
    this.log.info?.(`[write] записано ${frames.length} кадров`);
    return { frames: frames.length };
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
