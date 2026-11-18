# Архитектура M62 из ALSA UCM-профиля (PR #826, NTMan)

> https://github.com/alsa-project/alsa-ucm-conf/pull/826
> Автор: NTMan (тот же, чей протокол мы читали: `github.com/NTMan/topping-m62`)
> Статус: open, reviewed by perexg, force-push 18 окт 2026.

## Почему это критично

Мы всё время считали M62 «картой с 2 входами и 2 выходами плюс
микшер». Оказалось, у неё **UAC-поток на 10 каналов playback и 16
каналов capture**, и это не surround, а пять независимых стерео-шин
и шестнадцать колонок записи.

## 1. Структура потоков (ФАКТ из дескриптора)

| Режим | bcdDevice | Playback | Capture | Частоты |
|---|---|---|---|---|
| Mobile | 0145 | 2ch FL FR | 2ch FL FR | 44.1, 48 |
| Live Streaming | 0248 | 10ch | 16ch | 44.1, 48 |
| Pro Audio | 0327 | 10ch | 16ch | + 88.2, 96 |

**10 каналов playback** = 5 стерео-шин: Playback 1/2, 3/4, 5/6, 7/8, 9/10.
Карта сама суммирует их в выходы своим микшером.

**16 каналов capture**, порядок подтверждён **измерением по одному
столбцу**:

| колонки | что |
|---|---|
| 0, 1 | Analogue 1, 2 (IN 1, IN 2 — микрофонные) |
| 2, 3 | AUX 1, AUX 2 |
| 4, 5 | BT 1, BT 2 |
| 6, 7 | Mobile 1, Mobile 2 |
| 8..15 | **Loopback 1..8** |

Имена берутся из `iChannelNames` дескриптора — macOS их показывает,
Linux игнорирует.

**Важно:** дескриптор НЕ объявляет позиции каналов
(`bmChannelConfig = 0`), поэтому ядро подставляет ложный surround-порядок.
Отсюда все проблемы с PipeWire.

## 2. Loopback-возвраты приходят ЗАГЛУШЕННЫМИ

> "The eight loopback returns arrive MUTED. **Mic Capture Switch**
> carries one value per capture column and reads on for the first eight
> and off for the rest, so columns 8 to 15 deliver digital silence until
> something turns them on."

**Это объясняет, почему мы не видели loopback в дампе как «приходящий
назад»** — он приходит, но как обычные каналы захвата, а не как
HID-теги. И `Mic Capture Switch` — отдельный контрол на 16 значений.

## 3. Выходы: каждый слушает ОДИН источник

> "Each output on this card listens to one source chosen inside it…
> the five playback devices own it: they conflict with one another, and
> enabling one points the headphone output at its own bus."

То есть селектор `0x64:0x02` (Headphone Playback Source) выбирает,
какую из 5 шин слышно в наушниках. Это не «микшер в HID», а
маршрутизация выхода.

## 4. Полный скоростной режим — обязателен для 10/16 каналов

> "A full-speed isochronous endpoint carries at most 1023 bytes a
> millisecond, and ten 32-bit channels at 44.1 kHz, the lowest rate the
> card offers, need 1764."

Практическое: **если кабель/порт даёт full-speed, карта отдаёт
2-канальный поток** даже в Pro-режиме (bcdDevice остаётся 0327).
Это важно для нашего веб-клиента: нельзя предполагать 10 каналов.

## 5. Mobile-режим — это ДРУГАЯ карта

> "Mobile Mode is a two-in, two-out device… Its capture is not two
> inputs but the stereo output of one mixer over all of them, which the
> vendor's control application calls Recording. A microphone on IN 1,
> a phone on Bluetooth and a source on AUX are all in it at once; the
> host's own playback is not, and is heard in the headphones with the
> inputs."

То есть в Mobile:
- запись = одна стерео-сумма ВСЕХ входов;
- playback хоста идёт только в наушники, в запись не попадает;
- нет селекторов выходов и loopback.

## 6. Два уровня громкости последовательно

> "The card's own faders are digital and sit after the converter, so
> raising one lifts the converter's noise floor with the signal. The
> analogue stages — the two microphone preamps before the converter and
> the headphone stage after it — are reachable only over a vendor
> protocol on the card's HID interface."

Это ключевое объяснение, зачем вообще HID-гейны: **цифровой
USB-трим стоит ПОСЛЕ АЦП**, поэтому поднять SNR им нельзя. Аналоговый
предусилитель — только через HID.

## 7. Что это меняет у нас

1. **Наш UI неверно описывает карту.** Мы показываем микшер 5×11 как
   «матрицу», но у карты есть ещё и 5 стерео-шин playback, которые
   видны хосту как обычные аудиоканалы.
2. **`Mic Capture Switch`** (16 значений) — реальный контрол,
   которого у нас нет. Без него loopback-возвраты молчат.
3. **bcdDevice** — надёжный способ узнать режим (см. LINUX-DRIVER.md).
4. **Каналы capture надо именовать** — как в UCM.

## 8. Совпадения с нашими данными

| Что | Мы | UCM/драйвер |
|---|---|---|
| 5 шин микшера | `0x31..0x3c` (5 пар) | 5 стерео-шин Playback 1/2..9/10 ✓ |
| режимы 3 шт | Mobile/Live/Prof | 01xx/02xx/03xx ✓ |
| селекторы выходов | `0x64:0x02`, `0x62:0x02` | «output selector» ✓ |
| входы IN1/IN2/AUX/BT/OTG | 5 гейнов | те же 5 ✓ |
| Pro Audio ≠ Live | Prof 170-202 тегов | «identical layouts, differ in rates» — **расхождение** |

**Одно расхождение:** мы считали, что Live и Prof различаются
набором тегов (91-102 против 170-202 адресов). UCM-автор пишет, что
layout у них идентичен и различие только в частотах. Возможно, наши
дампы в Live были неполными. Надо проверить отдельно.
