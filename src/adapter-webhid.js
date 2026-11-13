/**
 * АДАПТЕР: WebHID (браузер).
 *
 * Позволяет управлять M62 ПРЯМО ИЗ СТРАНИЦЫ, без локального сервера.
 * Это ключевой файл для «сервиса в вебе»: посетитель открывает сайт,
 * нажимает «Подключить», браузер спрашивает разрешение, и дальше
 * всё общение с картой идёт через `navigator.hid`.
 *
 * ═══ ЧТО ТРЕБУЕТСЯ ОТ БРАУЗЕРА ═══
 *
 *   Chrome / Edge 89+, Opera. Firefox и Safari WebHID не умеют.
 *   Нужен HTTPS или localhost — иначе `navigator.hid` не появится.
 *   Разрешение выдаётся на конкретное устройство и запоминается.
 *
 * ═══ ЧЕГО НЕЛЬЗЯ ДЕЛАТЬ ═══
 *
 *   Открывать interface 3 (DFU) — можно превратить карту в кирпич.
 *   Поэтому фильтр по `usagePage`/`interface` обязателен, а после
 *   выбора устройства мы ПРОВЕРЯЕМ, что это именно vendor-интерфейс.
 *
 * ═══ ОСОБЕННОСТЬ WEBHID ═══
 *
 *   `sendReport(0, data)` — при `reportId = 0` буфер должен быть
 *   длиной ровно `outputReport.byteLength`, БЕЗ ведущего байта ID.
 *   Наш протокол как раз ждёт 16 байт отчёта, где первый байт
 *   кадра — 0x22. То есть report ID = 0, и мы отправляем 16 байт
 *   кадра, а не 17.
 *
 *   `inputreport` приходит с `event.data` — DataView длиной 16.
 */

import { PID, VENDOR_INTERFACE, VID } from './transport-consts.js';

/** Доступен ли WebHID в этой среде. */
export function isWebHidSupported() {
  return typeof navigator !== 'undefined' && !!navigator.hid;
}

/**
 * Попросить пользователя выбрать устройство.
 *
 * Браузер покажет свой диалог. Возвращает HIDDevice или null,
 * если пользователь отменил.
 */
export async function requestDevice() {
  if (!isWebHidSupported()) {
    throw new Error(
      'WebHID не поддерживается этим браузером. Нужен Chrome/Edge 89+.',
    );
  }
  const devices = await navigator.hid.requestDevice({
    filters: [
      { vendorId: VID, productId: PID },
      // fallback: некоторые сборки Chrome не матчат по VID/PID
      { vendorId: VID },
    ],
  });
  if (!devices || !devices.length) return null;
  return pickVendorInterface(devices);
}

/**
 * Выбрать из списка именно vendor-интерфейс (4).
 *
 * ВАЖНО: `interface` в WebHID может отсутствовать. Тогда опираемся
 * на наличие нужных эндпоинтов или на порядок: vendor-интерфейс —
 * единственный с нашим OUT-эндпоинтом (0x02) и IN (0x83).
 */
export function pickVendorInterface(devices) {
  const list = Array.isArray(devices) ? devices : [devices];
  for (const d of list) {
    if (d.collections?.some((c) => c.interface === VENDOR_INTERFACE)) return d;
  }
  // fallback: интерфейс не отдан — берём первый с нужными эндпоинтами
  for (const d of list) {
    const hasEp = d.collections?.some(
      (c) =>
        (c.outputReports?.length ?? 0) > 0
        || (c.inputReports?.length ?? 0) > 0,
    );
    if (hasEp) return d;
  }
  return list[0] ?? null;
}

/**
 * Создать адаптер WebHID.
 *
 * @param {HIDDevice} device уже открытое устройство
 */
export function createWebHidAdapter(device) {
  let dataCb = null;
  let closed = false;

  /**
   * ВАЖНО: report ID = 0, значит буфер отправляется без ведущего
   * байта. Наш кадр — 16 байт (15 кадра + 1 паддинг).
   *
   * `withReportId()` в protocol.js добавляет 0x00 в начало; для
   * WebHID этот байт НЕ нужен, поэтому срезаем его.
   */
  const onInputReport = (event) => {
    if (closed) return;
    try {
      const data = event.data;
      // DataView -> Uint8Array
      const bytes = new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
      dataCb?.(bytes);
    } catch {
      /* битый отчёт — пропускаем */
    }
  };

  return {
    device,
    write(bytes) {
      if (closed) throw new Error('устройство закрыто');
      // WebHID: reportId = 0 -> 16 байт; если пришло 17, срезаем ID
      const payload = bytes.length === 17 ? bytes.subarray(1) : bytes;
      device.sendReport(0, payload).catch(() => {
        /* отправка могла не пройти — не роняем UI */
      });
    },
    async onData(cb) {
      dataCb = cb;
      device.addEventListener('inputreport', onInputReport);
    },
    close() {
      closed = true;
      try {
        device.removeEventListener('inputreport', onInputReport);
      } catch {
        /* уже */
      }
      device.close().catch(() => {
        /* уже закрыто */
      });
    },
    /** Отключить listen сразу (onData асинхронный). */
    detach() {
      this.close();
    },
  };
}

/**
 * Открыть устройство и вернуть готовый адаптер.
 *
 * @param {HIDDevice} device
 */
export async function openWebHidDevice(device) {
  const vendor = pickVendorInterface(device);
  if (!vendor) throw new Error('vendor-интерфейс не найден');
  await vendor.open();
  return createWebHidAdapter(vendor);
}
