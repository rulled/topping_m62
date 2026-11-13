/**
 * АДАПТЕР: node-hid (Node.js, локальный сервер).
 *
 * Отделяет ввод-вывод от политики. Ядро (`transport-core.js`) про
 * node-hid ничего не знает и работает и в браузере.
 */

import HID from 'node-hid';

import { VID, PID, VENDOR_INTERFACE } from './transport-consts.js';

/**
 * Найти устройство.
 * @returns {null | {path:string, interface:number, product?:string, all:Array}}
 */
export function findDevice() {
  const candidates = HID.devices().filter(
    (d) => d.vendorId === VID && d.productId === PID,
  );
  if (!candidates.length) return null;
  const vendor = candidates.find((d) => d.interface === VENDOR_INTERFACE);
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

/**
 * Создать адаптер node-hid.
 *
 * Чтение: пачками по 64 отчёта за тик, как в старом transport.js —
 * наивное «один read за тик» теряет большую часть состояния
 * (замерено: ~65 отчётов/с вместо сотен).
 *
 * @param {{logger?: object, path?: string}} [opts]
 */
export function createNodeHidAdapter(opts = {}) {
  const log = opts.logger ?? console;
  const info = findDevice();
  if (!info) {
    throw new Error(
      `M62 не найден (VID 0x${VID.toString(16)} PID 0x${PID.toString(16)})`,
    );
  }

  const device = new HID.HID(opts.path ?? info.path);
  let dataCb = null;
  let closed = false;
  let timer = null;

  const BATCH = 64;
  const tick = () => {
    if (closed) return;
    for (let i = 0; i < BATCH; i++) {
      let data = null;
      try {
        data = device.readTimeout(5);
      } catch (err) {
        const code = err?.code ?? err?.errno;
        const fatal =
          ['ENODEV', 'ESHUTDOWN', 'EPROTO', 'EIO'].includes(code)
          || /could not read|hid_read_timeout/i.test(String(err?.message ?? ''));
        if (fatal) {
          try {
            device.close();
          } catch {
            /* уже */
          }
          closed = true;
        } else {
          log.warn?.('[m62] ошибка чтения:', err?.message ?? err);
        }
        return;
      }
      if (!data || !data.length) break;
      dataCb?.(data instanceof Uint8Array ? data : Uint8Array.from(data));
    }
    timer = setTimeout(tick, 0);
    timer.unref?.();
  };

  return {
    info,
    write(bytes) {
      if (closed) throw new Error('устройство закрыто');
      device.write([...bytes]);
    },
    onData(cb) {
      dataCb = cb;
      timer = setTimeout(tick, 0);
      timer.unref?.();
    },
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        device.close();
      } catch {
        /* уже */
      }
    },
  };
}

export { VID, PID, VENDOR_INTERFACE };
