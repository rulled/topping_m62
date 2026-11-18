# Полная карта контролов M62 из драйвера ядра (v10, патчи 1-8)

> Источник: серия v10, https://lkml.rescloud.iu.edu/2610.2/05210.html
> Файлы: `drivers/hid/hid-topping.c`, `sound/usb/mixer_topping.c`
> Прочитаны патчи: 2/8 (controls), 3/8 (E2x2), 4/8 (E2x2 controls),
> 5/8 (battery), 7/8 (mutes). Не прочитаны: 1/8 (транспорт), 6/8 (питание портов), 8/8.

## 1. MUTES — адреса (патч 7/8)

Каждый уровень имеет MUTE, где **1 = заглушено**, то есть
переключатель «звук идёт» — это ИНВЕРСИЯ значения.

| контрол | target | pair | проперти | 1 = mute |
|---|---|---|---|---|
| Mic1 Analog Capture Switch | `0x21` | — | `0x05` | да |
| Mic2 Analog Capture Switch | `0x22` | — | `0x05` | да |
| Aux Capture Switch | `0x23` | — | `0x05` | да |
| Bluetooth Capture Switch | `0x25` | — | `0x05` | да |
| OTG Capture Switch | `0x27` | — | `0x05` | да |
| Headphone Playback Switch | `0x64` | `0x63` | `0x04` | да |
| OTG Playback Switch | `0x62` | `0x61` | `0x04` | да |
| PCM Playback Switch (Mobile) | `0x53` | `0x54` | `0x04` | да |
| Recording Capture Switch (Mobile) | `0x51` | `0x52` | `0x04` | да |

**Loopback-возвраты MUTE не имеют** — вместо этого гейн ставится в
нулевой шаг (off). Запись 1 в `0x04`/`0x05` их не глушит.

**Важное поведение карты:** HP отпускает MUTE сам, если записать
громкость HP при активном MUTE (29 из 54 записей). Драйвер это
учитывает: уровень, выставленный под mute, только запоминается и
пишется при включении.

## 2. `0x11:0x18` — ЭТО БАТАРЕЯ, А НЕ СЧЁТЧИК СЕССИИ

**Исправление нашего прежнего вывода.** В NOTES §159 записано
«`0x11:0x18` = session counter». Это НЕВЕРНО.

По патчу 5/8: `0x11:0x18` = **уровень заряда батареи в процентах**
(0..100), приходит вскоре после подписки и при каждом изменении.

Мы видели там значения «9.2..9.3» — то есть 9%. Батарея садится.

## 3. HANDSHAKE: порядок и ожидание (патч 5/8)

Критично для нашего кода:

```
0x11:0x01 = 1     handshake
   ↓ ЖДАТЬ ОТВЕТ (карта отвечает 0x11:0x01, 8..851 мс, максимум 3.5 с)
0x11:0x24 = 1     subscribe
0x11:0x26 = 1     announce
```

> «Nothing follows the handshake until it is answered. … a write that
> reached the card 2 ms before the answer was not applied, while the
> rest of the same bind's writes were.»

**Что это значит для нас:** мы сейчас шлём handshake, subscribe и
announce подряд без ожидания. Часть записей может теряться. Нужно
дождаться ответа на handshake (кадр `0x11:0x01` от карты) или 3.5 с.

В Mobile-режиме без сессии карта вообще ничего не объявляет, поэтому
драйвер открывает сессию даже для чтения батареи.

## 4. Полная таблица контролов M62 (патч 2/8 + 7/8)

| имя | target | pair | prop | min | max | первый | кривая | режимы |
|---|---|---|---|---|---|---|---|---|
| Mic1 Analog Capture Volume | 0x21 | — | 0x04 | 0 | 88 | 0 | mic | все |
| Mic1 Analog Capture Switch | 0x21 | — | 0x05 | 0 | 1 | 1 | switch | все |
| Mic2 Analog Capture Volume | 0x22 | — | 0x04 | 0 | 88 | 0 | mic | все |
| Mic2 Analog Capture Switch | 0x22 | — | 0x05 | 0 | 1 | 1 | switch | все |
| Aux Capture Volume | 0x23 | — | 0x04 | 0 | 99 | 81 | out9 | все |
| Aux Capture Switch | 0x23 | — | 0x05 | 0 | 1 | 1 | switch | все |
| Bluetooth Capture Volume | 0x25 | — | 0x04 | 0 | 99 | 99 | out0 | все |
| Bluetooth Capture Switch | 0x25 | — | 0x05 | 0 | 1 | 1 | switch | все |
| OTG Capture Volume | 0x27 | — | 0x04 | 0 | 99 | 99 | out0 | все |
| OTG Capture Switch | 0x27 | — | 0x05 | 0 | 1 | 1 | switch | все |
| Headphone Playback Volume | 0x64 | 0x63 | 0x03 | 0 | 99 | 0 | out9 | все |
| Headphone Playback Switch | 0x64 | 0x63 | 0x04 | 0 | 1 | 1 | switch | все |
| OTG Playback Volume | 0x62 | 0x61 | 0x03 | 0 | 99 | 99 | out0 | все |
| OTG Playback Switch | 0x62 | 0x61 | 0x04 | 0 | 1 | 1 | switch | все |
| Loopback 1/2 Capture Volume | 0x51 | 0x52 | 0x03 | 0 | 102 | 90 | lb | Pro |
| Loopback 3/4 Capture Volume | 0x53 | 0x54 | 0x03 | 0 | 102 | 90 | lb | Pro |
| Loopback 5/6 Capture Volume | 0x55 | 0x56 | 0x03 | 0 | 102 | 90 | lb | Pro |
| Loopback 7/8 Capture Volume | 0x57 | 0x58 | 0x03 | 0 | 102 | 90 | lb | Pro |
| PCM Playback Volume | 0x53 | 0x54 | 0x03 | −90 | 12 | 0 | целые дБ | Mobile |
| PCM Playback Switch | 0x53 | 0x54 | 0x04 | 0 | 1 | 1 | switch | Mobile |
| Recording Capture Volume | 0x51 | 0x52 | 0x03 | −90 | 0 | 0 | целые дБ | Mobile |
| Recording Capture Switch | 0x51 | 0x52 | 0x04 | 0 | 1 | 1 | switch | Mobile |

### Селекторы (6, только Pro)

| имя | target | prop | первый item |
|---|---|---|---|
| Headphone Playback Source | 0x64 | 0x02 | Playback 1/2 (9) |
| OTG Playback Source | 0x62 | 0x02 | Playback 1/2 (9) |
| Loopback 1/2 Capture Source | 0x51 | 0x02 | Playback 1/2 (9) |
| Loopback 3/4 Capture Source | 0x53 | 0x02 | Playback 3/4 (10) |
| Loopback 5/6 Capture Source | 0x55 | 0x02 | BT (7) |
| Loopback 7/8 Capture Source | 0x57 | 0x02 | OTG IN (8) |

**ВАЖНО:** селектор отвечает на ОДИН адрес пары (у выхода — второй,
у loopback — первый). Гейн и mute — в ОБА адреса пары.

### Таблица значений селектора (14 пунктов, дыра на 4 и 5)

```
пункт: Mix A Mix B Mix C IN 1 IN 2 IN 1+2 AUX  BT  OTG IN PB1/2 PB3/4 PB5/6 PB7/8 PB9/10
код:     1     2     3    6    7     8     9   10   11    12    13    14    15    16
```

## 5. `Mic Capture Switch` — НЕ HID-тег!

Из UCM-профиля (`research/UCM-ARCHITECTURE.md`):

> «Mic Capture Switch carries one value per capture column and reads
> on for the first eight and off for the rest, so columns 8 to 15
> deliver digital silence until something turns them on.»

**Это UAC-контрол (USB Audio Class), а не HID.** То есть он живёт в
стандартном audio-интерфейсе, не в vendor-протоколе. Его нельзя
прочитать через interface 4.

Практическое следствие: **8 loopback-каналов захвата молчат, пока
этот переключатель не включён**. Включается либо через ALSA/ОС, либо
через MCC. Через наш HID-канал — никак.

## 6. Что это значит для нашего проекта

### Исправить:
1. **`0x11:0x18` — батарея**, а не счётчик сессии. Показывать заряд.
2. **Ждать ответ на handshake** перед subscribe/announce — иначе
   часть записей теряется.
3. **Mutes** — 9 переключателей, 1 = mute (инверсия).
4. **Loopback-гейны** — 4 пары, таблица Q25 на 103 значения.
5. **Селекторы** — 6 штук, 14 пунктов с дырой.

### Нельзя через HID:
- `Mic Capture Switch` (UAC-контрол) — от него зависит, слышны ли
  loopback-каналы.

### Новые возможности для пользователя:
- **Заряд батареи** — раньше не показывали вовсе.
- **Mutes входов/выходов** — безопасное глушение.
- **Loopback** — маршрутизация того, что играет, обратно в запись.
