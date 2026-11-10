/**
 * 48V (ФАНТОМНОЕ ПИТАНИЕ) — КОМАНДА НАЙДЕНА.
 *
 * ═══ ГЛАВНОЕ ═══
 *
 * 48V — это КОМАНДА, а не состояние. Устройство принимает её и
 * НЕ СООБЩАЕТ обратно в потоке.
 *
 * Доказано захватом 2026-11-10 (`capture-48v-and-mask.ps1`, 28.5 МБ).
 * Кнопка 48V нажата дважды, и в окнах ±1.5 с вокруг нажатий:
 *
 *     27.666 с   0x21:0x03 = 1   <<< включить
 *     34.712 с   0x21:0x03 = 0   <<< выключить
 *
 * Всё остальное в окнах — периодические кадры подписки (0x11:0x24).
 *
 * ═══ ПОЧЕМУ ЭТО ВАЖНО ═══
 *
 * Раньше не получалось: я писал 0x21:0x03 и ждал, что изменится
 * `0x11:0x19`. Оно не менялось — и я делал вывод «не работает».
 *
 * На самом деле за 40 секунд захвата (с включением и выключением
 * 48V) состояние `0x11:0x19` пришло РОВНО ОДИН РАЗ, на 6-й секунде,
 * при старте MCC. То есть устройство не отражает изменения 48V
 * в потоке вообще.
 *
 * **Метод проверки был неверным, а не запись.**
 *
 * ═══ АДРЕСА ═══
 *
 *   команда IN1:  0x21:0x03   1 = включить, 0 = выключить
 *   команда IN2:  0x22:0x03   (по симметрии, НЕ проверено отдельно)
 *   состояние:    0x11:0x19 (IN1) / 0x11:0x1a (IN2) —
 *                 приходит только когда MCC сам его меняет
 *
 * ═══ ПРАКТИКА ═══
 *
 * Обратного чтения нет. Значит состояние 48V надо хранить у себя,
 * как микшер, loopback и ducking.
 */

/** Команда включения/выключения фантома. */
export const PHANTOM = {
  IN1: { command: { target: 0x21, prop: 0x03 }, stateTag: '0x11:0x19' },
  IN2: { command: { target: 0x22, prop: 0x03 }, stateTag: '0x11:0x1a' },
};

export const PHANTOM_CHANNELS = Object.keys(PHANTOM);

/**
 * Кадр для включения/выключения фантома.
 *
 * @param {'IN1'|'IN2'} channel
 * @param {boolean} on
 * @returns {Array<{target:number, prop:number, value:number}>}
 */
export function buildPhantomFrames(channel, on) {
  const p = PHANTOM[channel];
  if (!p) {
    throw new Error(`неизвестный вход: ${channel}; допустимо ${PHANTOM_CHANNELS.join(', ')}`);
  }
  if (typeof on !== 'boolean') {
    throw new Error('on должен быть true или false');
  }
  return [{ target: p.command.target, prop: p.command.prop, value: on ? 1 : 0 }];
}

/**
 * Читает СОСТОЯНИЕ фантома из снимка, если оно там есть.
 *
 * ВНИМАНИЕ: обычно его там НЕТ — устройство не сообщает 48V при
 * изменении командой. Тег приходит только когда MCC сам его меняет.
 * Возвращает null, если тега нет — это норма, а не ошибка.
 */
export function readPhantomState(snapshot, channel) {
  const p = PHANTOM[channel];
  if (!p) return null;
  const [ttHex, ppHex] = p.stateTag.split(':');
  const hexKey = `${ttHex.slice(2)}:${ppHex.slice(2)}`;
  const v = snapshot?.[hexKey];
  if (v === undefined) return null;
  return { channel, on: v === 1, raw: v };
}

/** Описание для API. */
export function describePhantom() {
  return {
    channels: PHANTOM_CHANNELS,
    addresses: Object.fromEntries(
      Object.entries(PHANTOM).map(([k, p]) => [k, {
        command: `0x${p.command.target.toString(16)}:0x${p.command.prop.toString(16).padStart(2, '0')}`,
        stateTag: p.stateTag,
        commandNote: '1 = включить фантом, 0 = выключить',
      }]),
    ),
    note: '48V — команда без обратной связи. Устройство не сообщает изменение '
      + 'в потоке. Состояние надо хранить у себя.',
    warning: 'Фантомное питание подаётся на микрофонный вход. '
      + 'НЕ включать, если к входу подключена линия или инструмент — '
      + 'это может повредить оборудование.',
  };
}
