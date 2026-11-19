/**
 * ОПРЕДЕЛЕНИЯ ТИПОВ ДЛЯ WEBHID.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Проверка типов (`npm run typecheck`) не знает про `navigator.hid`:
 * WebHID нет в стандартной библиотеке TypeScript, потому что он
 * до сих пор не во всех браузерах.
 *
 * Без этих объявлений проверка выдаёт «Property 'hid' does not exist
 * on type 'Navigator'» — и вместе с ним тонет всё остальное. С
 * объявлениями проверка становится полезной: видно реальные ошибки,
 * а не отсутствие типов.
 *
 * ═══ ЧТО ОПИСАНО ═══
 *
 * Только то, что мы используем: запрос устройства, открытие,
 * отправка и приём отчётов. Полная спецификация WebHID больше.
 */

/** Устройство HID, каким его отдаёт браузер. */
interface HIDDevice {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: (ev: HIDInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (ev: HIDInputReportEvent) => void): void;
}

/** Описание коллекции — по нему мы ищем vendor-интерфейс (4). */
interface HIDCollectionInfo {
  usagePage?: number;
  usage?: number;
  /** Номер USB-интерфейса. Может отсутствовать. */
  interface?: number;
  inputReports?: unknown[];
  outputReports?: unknown[];
}

/** Событие входящего отчёта. */
interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

/** Фильтр для запроса устройства. */
interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[];
}

interface HID {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid: HID;
}
