# M62 Web Client — Backend API

Полный справочник для разработчика фронтенда.

**11 GET + 10 POST эндпоинтов + WebSocket.**
Все проверены на живом устройстве: `node src/tools/verify-coverage.js` → **42/42**.

> **Устарело, см. ниже.** Счётчики в шапке не обновлялись с раннего этапа.
> Фактически в `src/server.js` сейчас **50 уникальных путей**
> (56 пар метод+путь: у 6 путей есть и GET, и POST).
> `node src/tools/audit-docs.js` сверяет это с документацией: **50 = 50**.

---

## Быстрый старт

```bash
npm install
npm start                    # HTTP на 127.0.0.1:8787
```

Переменные окружения:
- `M62_PORT` — порт (по умолчанию `8787`)
- `M62_HOST` — адрес (по умолчанию `127.0.0.1`)

**Проверить, что всё живо:**
```bash
curl http://127.0.0.1:8787/api/health
```

---

## Архитектура: три канала данных

Устройство отдаёт состояние **тремя разными путями**. Это не прихоть —
так устроен M62.

| канал | что там | где модуль |
|---|---|---|
| **HID** | громкости, селекторы, метры, джеки, настройки, эффекты, компрессор, EQ входов, **EQ наушников** | `transport.js` |
| **workspace-файл** | микшер, входы (48V, GAIN, MIC), loopback, outputs, ducking, реверб | `workspace-service.js` |
| **UI M Control Center** | реверб, компрессор (альтернативный путь записи) | `ui-control.js` |

> **Исправлено 2026-11-08.** Прежняя формулировка «микшер и EQ недоступны
> через HID вообще (проверено перебором)» **неверна**. Она появилась из
> ошибочного метода: работающий MCC откатывал записи, а снимки состояния
> были короче, чем нужно для прихода блоков.
>
> Актуально:
> - **EQ входов** (`0x91..0x94`) — читается и пишется через HID, проверено 8/8.
> - **EQ наушников** (`0xa1..0xaa`) — читается и пишется через HID,
>   проверено (40 → 20 при открытом окне, 40 → 30 при закрытом).
> - **Микшер** (`0x31..0x3c`) — через HID **пишется** пакетом внутри bulk push
>   `0x11:0x20` (200 кадров); **обратно не читается** никогда.
> - **Компрессор** (`0x46:0x01..0x08`) — пишется через HID, проверено 8/8.
> - **Реверб** (`0x44:0x08..0x0f`) — читается через HID; запись относительная.
>
> Обязательное условие для EQ: периодический `0x11:0x26` (ANNOUNCE) —
> одного запроса при открытии мало, блоки `0x91`/`0xa1` приходят только
> после повторного. См. [`EQ-HP.md`](EQ-HP.md) и [`PROTOCOL.md`](PROTOCOL.md).

### Модули

| файл | роль |
|---|---|
| `src/crc16.js` | CRC-16/MODBUS |
| `src/protocol.js` | сборка/разбор кадра |
| `src/transport.js` | HID: подписка, keepalive, чтение пачками |
| `src/controls.js` | 7 громкостей, 2 селектора, 15 источников |
| `src/controls-service.js` | операции с громкостями/селекторами |
| `src/settings.js` | каталог настроек устройства |
| `src/settings-service.js` | чтение/запись настроек |
| `src/tags.js` | классификатор всех HID-тегов |
| `src/eq-hp.js` | EQ наушников: чтение, запись, описание полос |
| `src/workspace.js` | парсер INI-файлов MCC |
| `src/workspace-service.js` | чтение/запись workspace |
| `src/ui-control.js` | реверб и компрессор через UIAutomation |
| `src/modes.js` | определение режима устройства |
| `src/snapshots.js` | свои снимки состояния |
| `src/eq-mixer.js` | каталог адресов EQ/микшера (справочно) |
| `src/server.js` | HTTP + WebSocket |

---

## HTTP API

### `GET /api/health`

```json
{
  "ok": true,
  "connected": true,
  "stats": { "reads": 4032, "writes": 5, "parseErrors": 0, "idle": 2073 },
  "clients": 1,
  "uptimeSec": 92,
  "memory": { "rssMb": 55.2, "heapUsedMb": 10.4, "heapTotalMb": 17.7 }
}
```

**Проверенная стабильность (92 с непрерывной работы):**
- прирост чтений — ровно 2560 за каждые 5 с (разброс 0)
- ошибки парсинга — 0
- события — 122 за 5 с, минимум 120 (keepalive не срывался)
- RSS — 54.2 → 55.7 МБ (+2.8%), кеш тегов не растёт

### `GET /api/device`

Наличие устройства + описание контролов.

### `GET /api/mode`

**Режим устройства и что в нём доступно.** Тег режима (`0x11:0x1d`)
устройство не возвращает — определяется косвенно.

```json
{
  "ok": true,
  "mode": "Live",
  "confidence": "high",
  "reasons": ["папка workspace: Live"],
  "capabilities": {
    "mixerBuses": 5,
    "loopback": true,
    "effects": true,
    "eqInputs": true,
    "eqHeadphone": false,
    "ducking": true,
    "compressor": true
  },
  "actual": {
    "mixerChannels": 10,
    "loopbackCount": 4,
    "eqBlocks": ["EQ_IN1", "EQ_IN2"],
    "hasEffects": true,
    "hasCompressor": true,
    "hasDucking": true
  }
}
```

> **Для фронта:** интерфейс не может быть статичным. В Mobile нет микшера,
> в Pro нет эффектов. Реагируйте на `capabilities` и `actual`.

### `POST /api/mode`

**Смена режима.** Работает прямым HID-кадром `0x11:0x1d` — M Control Center
не нужен.

```json
{ "mode": "Prof" }
```

Допустимо: `Mobile`, `Live`, `Prof`.

```json
{ "ok": true, "mode": "Prof", "value": 3, "reloaded": true,
  "note": "устройство перезагрузилось; активный workspace мог смениться" }
```

**⚠️ Устройство перезагружается на 1–8 секунд.** Запрос держится ~14 секунд.
После смены меняется активный workspace-файл и набор доступных блоков —
перечитайте `/api/mode` и `/api/workspace`.

**Проверено:** все три режима переключаются в обе стороны
(Live↔Prof↔Mobile).

### `GET /api/controls`

7 громкостей, 2 селектора, 15 источников.

```json
{
  "volumes": [
    { "id": "hp", "name": "Headphone Playback Volume",
      "min": 0, "max": 99, "current": 50, "db": -20.5, "hasPair": true }
  ],
  "selectors": [
    { "id": "hpSource", "name": "Headphone Playback Source",
      "current": 12, "currentLabel": "Playback 1/2" }
  ],
  "sources": [
    { "index": 0, "label": "Unknown", "value": 0, "isChoice": false }
  ]
}
```

**Особенности:**
- Диапазоны разные: `0..88` для Mic-1/Mic-2, `0..99` для остальных.
- Индекс `0` = mute.
- Селекторы **не читаются** — `current: null`, если клиент сам не записал.
- `Unknown` (`index: 0`) — не выбор, запись = тихий no-op.

### `POST /api/volume`

```json
{ "id": "hp", "value": 50 }
```

### `POST /api/selector`

```json
{ "id": "hpSource", "index": 10 }
```
> `index` — индекс в списке `sources`, **не** значение для устройства.

### `GET /api/settings` · `GET /api/settings?refresh=1`

Настройки устройства. Без `refresh` — из кеша, с `refresh=1` — запросить у устройства.

```json
{
  "toggles": [
    { "id": "bluetooth", "name": "Bluetooth", "value": 1, "label": "On",
      "options": [{ "value": 0, "label": "Off" }, { "value": 1, "label": "On" }] }
  ],
  "enums": [
    { "id": "brightness", "name": "Brightness", "value": 2, "label": "Bright",
      "readable": true, "reloadsDevice": false,
      "options": [
        { "value": 0, "label": "Dim" },
        { "value": 1, "label": "Normal" },
        { "value": 2, "label": "Bright" }
      ] }
  ],
  "status": [{ "id": "counter", "name": "Счётчик изменений", "value": 78 }],
  "commands": [
    { "id": "savePreset1", "name": "Save preset 1", "destructive": false },
    { "id": "restoreDefault", "name": "Reset to factory default", "destructive": true }
  ]
}
```

**Про `mode`:** `readable: false`, `reloadsDevice: true` — не читается
через HID, смена перезагружает устройство. Для смены используйте
`POST /api/mode` — он корректно ждёт перезагрузку.

### `POST /api/settings/toggle`

```json
{ "id": "bluetooth", "value": 1 }
```

### `POST /api/settings/enum`

```json
{ "id": "brightness", "value": 2 }
```

### `POST /api/settings/command`

```json
{ "id": "loadPreset1" }
```

Необратимые требуют `confirm`:
```json
{ "id": "restoreDefault", "confirm": true }
```
Без `confirm` вернёт ошибку.

### `POST /api/settings/full-state`

**Полное состояние через `Load preset`.** Единственный способ получить
теги компрессора `0x46:0x01..0x08` — обычный `ANNOUNCE` их не отдаёт.

```json
{ "confirm": true, "which": 1 }
```

Возвращает **94 параметра вместо 36**, включая весь компрессор.

**⚠️ Побочный эффект:** это **загружает пресет** — состояние устройства
меняется на сохранённое. Без `confirm: true` вернёт ошибку.

**Про шкалу Ratio:** HID отдаёт `40`, а файл workspace хранит `4`.
То есть **HID = значение × 10**. Остальные поля компрессора совпадают 1:1
(проверено: Threshold, Attack, Release, Gain, Mix).

**`Load preset` — единственный способ записать Ratio/Attack/Release/Mix.**
Эти параметры компрессора не имеют прямой записи (ни файл, ни HID, ни
регуляторы). Но пресет хранит их целиком — проверено: `Ratio` был сбит
в `0.8`, после `Load preset1` вернулся `4`.

То есть для изменения этих полей нужно: сохранить пресет с нужным
значением через MCC, затем загружать его.

### `GET /api/workspace` · `GET /api/workspace?refresh=1`

**Микшер, EQ, входы, loopback, outputs, ducking, эффекты, компрессор.**

```json
{
  "available": true,
  "mode": "Live",
  "name": "ввв",
  "inputs": [
    { "id": "Input_IN1", "channel": "IN1", "name": "IN 1",
      "mic": "MicHP", "phantom48": true, "solo": false, "mute": false,
      "gain": 20, "anti": 0, "balance": 100 }
  ],
  "mixer": [
    { "channel": "IN12", "name": "IN",
      "buses": {
        "A": { "gain": 9, "mute": false, "solo": false },
        "B": { "gain": 0, "mute": false, "solo": false }
      } }
  ],
  "eq": [
    { "id": "EQ_IN1", "switch": false, "gainInput": 0, "format": "in",
      "bands": [
        { "band": 1, "raw": "|0|632|0.7|6",
          "type": 0, "freq": 632, "q": 0.7, "gain": 6 }
      ] }
  ],
  "loopback": [
    { "id": "Loopback_LB12", "name": "Loopback 1/2", "source": "Mix A",
      "gain": -12, "gainLeft": 0, "gainRight": 0,
      "mute": true, "muteLeft": false, "muteRight": false, "link": true }
  ],
  "outputs": [
    { "id": "Output_HP", "name": "HP", "source": "Playback 1/2", "gain": -20, "mute": false }
  ],
  "ducking": {
    "enabled": true, "switch": 1, "threshold": -25, "attack": 200,
    "reduction": 16, "release": 800, "map": { "IN1AUX": true }
  },
  "effects": {
    "inputLevels": { "input1": 3, "input2": 12, "aux": -90 },
    "muteFx": false,
    "noiseReduction": { "nc1": 35, "nc2": 30, "bypass": 15, "type": "NC1" },
    "reverb": {
      "type": "STUDIO",
      "studio": { "level": 4, "dryWet": 30, "decay": 11, "width": "0.7" }
    }
  },
  "compressor": {
    "switch": true, "threshold": -18, "ratio": 4,
    "attack": 5, "release": 200, "gain": 0, "mix": 100
  }
}
```

**ВАЖНО про микшер:** в активном workspace-файле у шин `A`, `B`, `C`
обычно только `gain`, `solo`, `mute`. Стерео-поля (`gainLeft`,
`gainRight`, `muteLeft`, `muteRight`, `link`, `anti*`, `balance*`)
присутствуют в файле, но парсер отдаёт их **только если они там есть**.
Фронт должен быть готов к обоим вариантам.

**ВАЖНО про EQ — два разных формата полос:**

| EQ | формат `raw` | пример |
|---|---|---|
| `EQ_IN1`, `EQ_IN2` | `\|тип\|частота\|Q\|gain\|` | `\|0\|632\|0.7\|6` |
| `EQ_HP` (Pro) | `тип\|gain\|частота\|Q\|флаг` | `0\|9\|35\|0.5395\|1` |

**Позиции gain и частоты поменяны местами.** При записи возвращайте
`raw` целиком, чтобы не ошибиться.

**Парсер это учитывает** и отдаёт единый вид:
```json
{ "band": 1, "raw": "0|9|35|0.5395|1",
  "type": 0, "freq": 35, "q": 0.5395, "gain": 9 }
```

**Реальные значения EQ_HP (Pro-режим, проверено):**
`sym: 35 Гц +9, 258 Гц −4.5, 2891 Гц −4, 4688 Гц +3.5, 9355 Гц +6, 14159 Гц +5`
— это стандартная сетка октавного EQ наушников, `GainOutput = −10`.

**Файл НЕ валидирует значения EQ** (проверено: тип 0–5, gain −24…24,
частота 20…30000, Q 0.1…20 — всё принимается). Реальные пределы задаёт
только UI, поэтому бекенд должен валидировать сам.

**ВАЖНО про эффекты — ДВЕ РАЗНЫЕ СТРУКТУРЫ по режимам:**

| режим | `effects.layout` | откуда берётся |
|---|---|---|
| Live, Prof | `integration` | `[Effect_Integration]` |
| Mobile | `split` | `[Effect_NC]` + `[Effect_Reverb]` раздельно |
| Prof | `none` | эффектов нет вообще |

В Mobile `inputLevels` все `null`, а `noiseReduction`/`reverb` — из своих
секций. Фронт должен проверять `layout`.

**ВАЖНО про входы — в Mobile их 6, в остальных 5:**

В Mobile появляется `[Input_PB12]` — Playback 1/2 как отдельный вход
(`ChannelName: "Playback 1/2"`). В Live/Prof его нет.

**ВАЖНО про loopback — в Mobile его нет как `Loopback_*`:**

Вместо него `[Output_LB12]` с `ChannelName: "Recording"`.
Парсер помечает такие выходы `isLoopback: true`.

### `GET /api/workspaces`

Список workspace-файлов, свежие первыми.

### `POST /api/workspaces/create`

Создаёт новый workspace копированием существующего.

```json
{ "mode": "Live", "name": "my-setup", "from": "ввв" }
```

`from` — необязательно; если не указан, берётся любой файл того же режима.

```json
{ "ok": true, "mode": "Live", "name": "my-setup",
  "path": "C:\\Program Files\\...\\M62_Live_my-setup.ini" }
```

### `POST /api/workspaces/delete`

```json
{ "mode": "Live", "name": "my-setup" }
```

**Активный workspace удалить нельзя** — вернёт ошибку. Сначала переключитесь.

### `POST /api/workspaces/switch`

```json
{ "mode": "Live", "name": "ввв" }
```

Записывает имя в реестр (`HKCU\Software\TOPPING\...\M62\M62_Live_Workspace`).

**⚠️ Применится только при следующем запуске MCC** — имя читается при старте.
UIAutomation-переключение через комбобокс **ломает интерфейс MCC** —
не используйте его.

> Workspace — это обычный INI-файл в папке режима. Все три операции
> работают с файлами напрямую, MCC не нужен.

### `POST /api/workspace/apply`

**Запись в микшер, EQ, входы, loopback, outputs, ducking.**

```json
{
  "changes": [
    { "section": "Input_IN1",  "key": "48V",       "value": 1 },
    { "section": "Mixer_IN12", "key": "MixA_GAIN", "value": 7 },
    { "section": "EQ_IN1",     "key": "Eq%401",    "value": "|0|632|0.7|6" }
  ]
}
```

**⚠️ Это перезапускает M Control Center — цикл ~17 секунд.**

Метод: закрыть MCC → записать файл → запустить MCC → перечитать.
Валидация всех изменений идёт **до** остановки MCC, плюс авто-бэкап `.autobak`.

**Ограничение:** запись работает только для параметров, **доступных
в текущем режиме**. Например `EQ_IN1.Switch` в Live сбрасывается в 0,
потому что EQ входов в Live нет.

### `GET /api/ui-controls`

Координаты кнопок реверба, **всех 12 dial'ов**, кнопок FX, а также
**аудиопараметры драйвера**.

**`allDials`** — полная карта: какой dial что меняет и каким путём лучше.

```json
{
  "allDials": {
    "inputIn1":  { "x": 164, "y": 699, "changes": "Input_IN1.GAIN",  "betterVia": "file" },
    "compThreshold": { "x": 756, "y": 1302, "changes": "Compressor.Threshold", "betterVia": "ui" },
    "reverbDryWet":  { "x": 1021, "y": 1105, "changes": "DryWet<Type>", "betterVia": "ui" }
  }
}
```

`betterVia`:
- `file` — то же значение проще и точнее записать через `/api/workspace/apply`
- `ui` — прямой записи нет, только через dial

```json
{
  "audioOptions": {
    "sampleRate": [44100, 48000],
    "bufferSize": [8, 16, 32, 64, 128, 256, 512, 1024, 2048]
  },
  "compressorWritable": {
    "viaDial": ["threshold", "gain"],
    "onlyViaPreset": ["ratio", "attack", "release", "mix"]
  }
}
```

**Sample rate и buffer size** — параметры аудиодрайвера. Их **нет в HID**
и **нет в workspace-файле** — только в UI MCC (комбобоксы в шапке).
Прочитать можно инструментом `node src/tools/read-audio-params.js`.

### `POST /api/mcc/click`

**Нажатие кнопки MCC по имени** — надёжнее, чем по координатам
(координаты зависят от разрешения и DPI, имена — нет).

```json
{ "name": "Chat" }
```

Доступные имена (`namedButtons` в `/api/ui-controls`):

| имя | что делает |
|---|---|
| `Chat` | включает ducking |
| `Vocal` | выключает ducking |
| `Save preset1` / `Save preset2` | сохраняет пресет |
| `Load preset1` / `Load preset2` | загружает пресет |

```json
{ "ok": true, "name": "Chat", "result": "OK idx=116" }
```

Неверное имя → 400 с сообщением «элемент не найден».

**Проверено:** `Chat` → `DuckingSwitch = 1`, `Vocal` → `0`.

### `GET /api/reverb`

Типы реверба, доступные параметры и текущее состояние.

```json
{
  "ok": true,
  "types": ["STUDIO", "LIVE", "HALL", "Bypass"],
  "typeByTag": { "1": "Bypass", "2": "STUDIO", "3": "LIVE", "4": "HALL" },
  "params": {
    "dryWet": { "x": 1021, "y": 1105, "perNotch": 1 },
    "level":  { "x": 1020, "y": 1262, "perNotch": 0.67 },
    "decay":  { "x": 958,  "y": 1384, "perNotch": 1 },
    "width":  { "x": 1086, "y": 1384, "perNotch": 0.05 }
  },
  "current": { "type": "STUDIO", "studio": { "level": 4, "dryWet": 30, "decay": 11, "width": "0.7" } },
  "caveats": [ ... ]
}
```

### `GET /api/audio-params`

Аудиопараметры драйвера.

```json
{
  "ok": true,
  "current": { "sampleRate": "44100", "bufferSize": "32" },
  "options": {
    "sampleRate": [44100, 48000],
    "bufferSize": [8, 16, 32, 64, 128, 256, 512, 1024, 2048]
  },
  "caveats": [
    "меняются только через UIAutomation-клавиатуру",
    "требуется запущенный M Control Center",
    "изменение sample rate может прервать аудиопоток"
  ]
}
```

### `POST /api/audio-params`

```json
{ "name": "bufferSize", "value": 64 }
```

```json
{ "ok": true, "name": "bufferSize", "target": 64, "position": 3, "result": "SET" }
```

**⚠️ Почему только клавиатурой:** проверены три способа —
`SelectionItem.Select()` и `ValuePattern.SetValue()` **возвращают успех,
но не применяют значение**. Работает только эмуляция клавиатуры
(Expand → HOME → стрелки → ENTER).

**Проверено:** `bufferSize 32 → 64 → 32`.

**Требует запущенного MCC** — это UIAutomation, не HID.

### `GET /api/eq`

Состояние эквалайзера. **Важно:** `Switch` хранится **только в UI MCC** —
файл врёт (`Switch=1` даже когда выключен), HID не отдаёт вовсе.

```json
{
  "ok": true,
  "windowOpen": false,
  "switches": {
    "in1": { "enabled": false, "raw": "Off", "button": [122, 270] },
    "in2": { "enabled": false, "raw": "Off", "button": [278, 270] }
  },
  "layout": {
    "bands": [714, 796, 878, 960],
    "rows": { "type": 508, "gain": 564, "freq": 642, "q": 720 },
    "ranges": {
      "gain": { "min": -12, "max": 12, "unit": "dB" },
      "freq": { "min": 590, "max": 22000, "unit": "Hz" },
      "q": { "min": 0.707, "max": 15, "unit": "" }
    },
    "filterTypes": ["peaking", "lowpass", "highpass", "lowshelf", "highshelf"]
  },
  "trustworthy": {
    "switch": "TogglePattern кнопки EQ",
    "types": "ValuePattern комбобоксов в окне EQ",
    "values": "только файл workspace"
  }
}
```

Если окно EQ открыто — добавляется `types` с типами всех 4 полос.

### `POST /api/eq/switch`

Переключить EQ входа. **Работает без движения курсора** (TogglePattern).

```json
{ "input": "IN1", "enabled": true }
```

```json
{ "ok": true, "input": "IN1", "enabled": true, "changed": true, "verified": true }
```

`verified` — перечитанное состояние после переключения. Если `false`, значит
не применилось.

### `GET /api/eq/params`

Параметры полос из workspace-файла с расшифровкой типов.

```json
{
  "ok": true,
  "blocks": [
    {
      "id": "EQ_IN1",
      "format": "in",
      "bands": [
        { "band": 1, "raw": "|0|632|0.7|0",
          "type": 0, "typeName": "peaking",
          "freq": 632, "q": 0.7, "gain": 0 }
      ]
    }
  ]
}
```

**Ограничения EQ (ОБНОВЛЕНО 2026-11-07):**

| что | как |
|---|---|
| читать Switch | только `/api/eq` (не файл!) |
| менять Switch | `/api/eq/switch` (без курсора) |
| читать значения полос | `/api/eq/params` (из файла) |
| **менять Gain/Freq/Q** | **`POST /api/eq/band`** — клавиатурой на диле (см. ниже) |
| менять тип фильтра | `POST /api/eq/type` — реальным кликом по popup |
| включать/выключать полосу | `POST /api/eq/band/enable` |

> **ВАЖНО:** ранее здесь было написано «менять Gain/Freq/Q только
> перетаскиванием мыши — API-пути нет». Это УСТАРЕЛО. Открыт клавиатурный
> путь (SetFocus + стрелки), он даёт точную установку значения. Подробности —
> `research/NOTES.md` §110/§111.

### `GET /api/eq/scales`

Измеренные шкалы дилов EQ. Нужны фронту, чтобы рисовать ползунки
и переводить значение в позицию.

```json
{
  "ok": true,
  "gain": { "kind": "linear", "step": 1, "unit": "dB",
            "documentedRange": [-12, 12] },
  "freq": { "kind": "logarithmic", "formula": "f(n) = 20 * 1000^(n/100)",
            "steps": 100, "min": 20, "max": 20000,
            "stepRatio": 1.0715193052376064, "stepCents": 119.59,
            "verifiedPoints": 41 },
  "q":    { "kind": "table", "steps": 46, "min": 0.1, "max": 15,
            "ladder": [0.1, 0.104, ... 15],
            "warning": "документированный минимум 0.707 НЕВЕРЕН — реальный 0.1" }
}
```

**ФАКТЫ ПО ШКАЛАМ:**

| шкала | вид | шаг | диапазон |
|---|---|---|---|
| Gain | линейная | **1 дБ** | −12..+12 |
| Freq | логарифмическая | **1000^(1/100)** = 119.59 центов | **20..20000 Гц**, 100 шагов |
| Q | **табличная** | формулы нет | **0.1..15**, 46 шагов |

Формула частоты проверена на 41 измеренной точке, ошибка < 1%:
`f(n) = 20 * 1000^(n/100)`, обратно `n = 100*ln(f/20)/ln(1000)`.

Для Q формулы НЕТ (проверены и отвергнуты экспонента, atan, 1/Q, sqrt) —
используется таблица `ladder`.

### `POST /api/eq/band`

**Главный эндпоинт записи EQ.** Меняет Gain/Freq/Q полосы.

```json
{ "input": "IN1", "band": 2, "param": "freq", "value": 1000 }
```

- `input` — `IN1` (по умолчанию) или `IN2`
- `band` — 1..4
- `param` — `gain` | `freq` | `q`
- `value` — абсолютное целевое значение **ИЛИ** `delta` — относительный сдвиг

**Как работает:** бекенд пишет кадр напрямую в HID — свойство `0x03`
(gain) / `0x04` (частота) / `0x05` (Q) полосы. Окно MCC не нужно.

**Требования:** только открытое устройство (`POST /api/connect`).
MCC может быть закрыт или даже удалён.

**Ответ:**

```json
{
  "ok": true, "input": "IN1", "band": 2, "param": "freq",
  "via": "hid", "before": 632, "after": 1000, "frames": 1
}
```

`via: "hid"` — признак, что значение ушло кадром, а не через окно.

**Режим `delta`:** сдвиг от текущего значения. Текущее берётся из кеша
HID, если тег ещё не пришёл — вернётся `409` с подсказкой задать `value`.

**Проверено на живом устройстве (2026-11-10, MCC закрыт):**

| запрос | результат |
|---|---|
| `{band:1, param:'gain', value:3}` | 0 → **3 дБ**, подтверждено новой сессией |
| `{band:1, param:'freq', value:1000}` | 632 → **1000 Гц** |
| `{band:1, param:'q', value:1.0}` | 0.7 → **1.0** (устройство хранит Q×10000) |
| `{band:1, param:'gain', delta:2}` | сдвиг от текущего |

### `POST /api/eq/band/enable`

Включает/выключает полосу (свойство `0x01` или `0x06` блока).

```json
{ "input": "IN1", "band": 2, "enabled": true }
```

Без `enabled` — инвертирует текущее. Проверено: `0x91:01` 0 → 1, откат ОК.

### `POST /api/eq/type`

Тип фильтра полосы (свойство `0x02` / `0x07`).

```json
{ "input": "IN1", "band": 1, "type": "lowpass" }
```

**Ловушка кодов:** устройство нумерует типы с единицы, а массив
`filterTypes` в UI — с нуля:

```
peaking=1  lowpass=2  highpass=3  lowshelf=4  highshelf=5
```

Бекенд переводит имя в код сам (`DEVICE_TYPE_CODE`), клиенту передавать
числа не нужно. Проверено: `0x91:02` 1 → 2, откат ОК.

### `POST /api/eq/switch`

Общий включатель EQ входа: `0x9b:0x0f` для IN1, `0x9b:0x10` для IN2.

```json
{ "input": "IN1", "enabled": true }
```

Проверено: `0x9b:0f` 0 → 1, откат ОК.

### `POST /api/eq/open`

Открывает окно EQ в MCC двойным кликом по кнопке входа.

```json
{ "input": "IN1" }
```

**Больше не требуется** для записи — нужно только если фронт хочет
показать пользователю само окно MCC (диагностика).

### `GET /api/eq/types`

Типы фильтров 4 полос, из HID.

```json
{ "ok": true, "via": "hid", "input": "IN1",
  "bands": [ { "band": 1, "code": 1, "type": "peaking" } ],
  "filterTypes": ["peaking","lowpass","highpass","lowshelf","highshelf"],
  "typeCodes": { "peaking": 1, "lowpass": 2, "highpass": 3, "lowshelf": 4, "highshelf": 5 } }
```

Окно EQ не нужно.

### `GET /api/eq/dials`

Карта индексов дилов (диагностика UI-пути) и данные полос из HID.

```json
{ "ok": true, "via": "hid", "input": "IN1",
  "windowOpen": false,
  "bands": [ { "band": 1, "enable": 0, "gain": 0, "freq": 632, "q": 0.7 } ],
  "dials": null,
  "dialsError": "окно EQ закрыто — карта дилов недоступна" }
```

Без MCC `dials` будет `null`, но `bands` заполнены — это не ошибка.

> **Индексы НЕ хардкодятся** — они меняются при перезапуске MCC и смене
> разрешения. Всегда получайте их этим эндпоинтом или через `dialIndexMap()`.

### `POST /api/eq/type`

Смена типа фильтра. **Работает только реальным кликом мыши** —
`SelectionItemPattern.Select()` и `InvokePattern.Invoke()` на пунктах
popup возвращают успех, но НЕ применяют выбор.

```json
{ "input": "IN1", "band": 2, "type": "lowpass" }
```

Требует открытого окна EQ и перемещения курсора.

## Компрессор

Компрессор управляется **только через отдельное окно `COMP`** в MCC.
Кнопка `MORE` на панели эффектов открывает его.

Дилы компрессора не принимают ни drag, ни колесо, ни `ValuePattern.SetValue`.
Работает только **клавиатура**: `SetFocus` на дил + стрелки, по 1 шагу за нажатие.

**Значения хранятся в файле workspace** (`Compressor.*`) — он и есть источник
правды. Окно `COMP` не показывает числа через UIA (дилы рисуют их сами).

### Шкалы (измерены)

| параметр | диапазон | шаг | единица |
|---|---|---|---|
| `Threshold` | −36 … 0 | 1 | dB |
| `Ratio` | 1 … 1000000 | нелинейный | :1 |
| `Attack` | 1 … 500 | 1 | ms |
| `Release` | 1 … 601 | 1 | ms |
| `Gain` | 0 … 36 | 1 | dB |
| `Mix` | 0 … 100 | 1 | % |

`Ratio` **нелинейный**: до 4.0 шаг 0.1 (30 позиций), дальше мультипликативно
(4.4, 4.7, 5.2 … 46.9). Последняя позиция `1000000` означает **∞/Limit**.
Значения пишутся как float32, поэтому `4.4` в файле выглядит как
`4.400000095367432`.

### `GET /api/compressor`

Значения + состояние окна + шкалы.

```json
{
  "ok": true,
  "source": "hid",
  "values": {
    "switch": false, "threshold": -28, "ratio": 4, "attack": 5,
    "release": 200, "gain": 10, "gainAuto": false, "mix": 100
  },
  "window": null,
  "hid": { "fields": [...], "limits": {...}, "addresses": {...} },
  "scales": { "params": [...], "ratioLadder": [...], "ratioInfinity": 1000000 }
}
```

`source` — откуда значения: `hid` (теги `0x46`), `workspace` (файл MCC,
резерв если устройство ещё не отдало блок) или `none`.
`window` = `null`, если MCC не запущен — это нормально.

### `GET /api/compressor/scales`

Только шкалы — для валидации на фронте без чтения устройства.

```json
{
  "ok": true,
  "params": [
    { "id": "Threshold", "min": -36, "max": 0, "step": 1, "unit": "dB", "nonlinear": false },
    { "id": "Ratio", "min": 1, "max": 1000000, "step": null, "unit": ":1",
      "nonlinear": true, "ladderSize": 61 }
  ],
  "ratioLadder": [1, 1.1, ..., 46.9, 1000000],
  "ratioInfinity": 1000000
}
```

### `POST /api/compressor/open` · `POST /api/compressor/close`

Открыть/закрыть окно `COMP` в MCC. Оба идемпотентны.

```json
{ "ok": true, "result": "OPENED", "window": { ... } }
```

`result`: `OPENED` | `ALREADY_OPEN` | `OPEN_FAILED` | `NO_MORE_BUTTON`;
для закрытия — `CLOSED` | `ALREADY_CLOSED` | `NO_CLOSE_BUTTON`.

**Больше не требуется для записи** — нужно только если фронт хочет
показать пользователю само окно MCC.

### `POST /api/compressor/param`

Установить абсолютное значение **или** сдвинуть на дельту.

```json
{ "param": "Attack", "value": 12 }
```
```json
{ "param": "Mix", "delta": -20 }
```

**Имена принимаются в обоих стилях:** `Attack` и `attack`, `Threshold`
и `threshold`, и так далее. Это сделано для совместимости.

```json
{ "ok": true, "param": "attack", "before": 5, "after": 12,
  "changed": true, "via": "hid", "frames": 1 }
```

`via: "hid"` — значение ушло кадром в `0x46`, окно MCC не нужно.

Ошибки (400):

| ситуация | ответ |
|---|---|
| неизвестный `param` | `неизвестный параметр: Foo` + список `known` |
| вне диапазона | `gain: значение 99 вне диапазона 0..36` |
| `delta` без известного текущего | `409` + подсказка задать `value` |

**Проверено на живом устройстве (2026-11-10, MCC закрыт), 5 из 5:**

| параметр | было → стало |
|---|---|
| Threshold | −28 → **−20 дБ** |
| Ratio | 40 → **60** (то есть 4.0 → 6.0) |
| Attack | 5 → **10 мс** |
| Release | 200 → **300 мс** |
| Mix | 100 → **90** |

Каждое значение подтверждено новой сессией, откат ОК.

### `POST /api/compressor/switch`

Переключатели компрессора (свойства `0x01` и `0x07`).

```json
{ "id": "switch", "value": false }
```
```json
{ "id": "gainAuto", "value": true }
```

```json
{ "ok": true, "id": "gainAuto", "before": false, "value": true,
  "changed": true, "via": "hid", "frames": 1 }
```

`id`: `switch` (вкл/выкл компрессор) или `gainAuto`
(авто-мейкап усиления). Значения в ответе — `"On"`/`"Off"` из `TogglePattern`.

**Проверено:** оба переключателя в обе стороны.

### Требования к окружению

Окно `COMP` — **отдельное top-level окно Qt**. `SendKeys` отправляет клавиши
в активное окно, поэтому сервер поднимает его через `AttachThreadInput` +
`BringWindowToTop` + `SetForegroundWindow` и **проверяет `foreground` до и
после** установки фокуса. При несовпадении нажатия не отправляются.

Это защита от реального инцидента: когда окно закрылось между итерациями,
клавиши улетели в меню «Пуск» и сбили значение в соседнем приложении.

### `POST /api/reverb`

```json
{ "type": "STUDIO" }
```
Допустимо: `STUDIO`, `LIVE`, `HALL`, `Bypass`. **Проверены все 4.**
### `POST /api/reverb/param`

**Параметры реверба меняются только ОТНОСИТЕЛЬНО** — dial не даёт задать
абсолютное значение.

```json
{ "param": "dryWet", "delta": 2 }
```

```json
{ "ok": true, "param": "dryWet", "delta": 2, "notches": 2 }
```

Допустимые `param`: `dryWet`, `level`, `decay`, `width`.

**⚠️ При `ReverbType = "Bypass"` dial'ы не реагируют** — сначала выберите тип.
Точность — ±1 шаг (см. `perNotch`).

**Проверено:** `dryWet +2` → 30 → 32, `dryWet −2` → обратно 30.

### `GET /api/tags`

Карта всех известных HID-тегов: метры, эффекты, компрессор, ducking,
EQ, джеки, громкости, селекторы.

### `GET /api/eq-mixer`

Справочный каталог адресов EQ/микшера из реверса кода MCC.

---

## Микшер

Микшер **расшифрован полностью** из захвата USBPcap (см.
[`MIXER.md`](MIXER.md)). Это важная особенность: он не похож на остальные
параметры.

### Как он устроен

```
5 шин:    Mix A, B, C, D, E — каждая пара групп L/R
11 источников: PB12, PB34, PB56, PB78, IN1, IN2, AUX, OTGIN, BT, PB910, FX
значение: Q25 (2^25 = 0 дБ, 0 = mute)
```

### Три правила, без которых не работает

1. **Пишется только пакетом.** Одиночные записи в `0x31..0x3c` устройство
   игнорирует. Нужен брекет `0x11:0x20 = 1 ... 0`.
2. **Порядок кадров критичен.** Блок свойств → группа → свойство внутри
   блока. Проверено: совпадение всех 200 адресов с MCC.
3. **Не читается обратно.** Состояние хранит клиент. MCC при старте
   перезаписывает микшер своей матрицей из workspace-INI.

## 48V (фантомное питание)

Команда найдена захватом USBPcap 2026-11-10: `0x21:0x03`
(1 = включить, 0 = выключить). Для IN2 — `0x22:0x03` по симметрии.

**Это только команда.** Устройство не сообщает состояние 48V
в потоке — тег `0x11:0x19` приходит лишь когда MCC сам его меняет.
За 40 секунд захвата с включением и выключением он пришёл один раз.

**ОПАСНО.** Фантом подаётся на микрофонный вход. Если подключена
линия или инструмент — можно повредить оборудование. Поэтому
маршрут требует явного подтверждения.

### `GET /api/phantom`

Состояние (если устройство его сообщило) и карта адресов.

```json
{ "ok": true,
  "channels": { "IN1": null, "IN2": null },
  "addresses": { "IN1": { "command": "0x21:0x03", "stateTag": "0x11:0x19" } },
  "warning": "НЕ включать, если к входу подключена линия или инструмент" }
```

`null` в `channels` — норма: устройство не отдаёт состояние 48V.

### `POST /api/phantom`

```json
{ "channel": "IN1", "on": true, "confirm": true }
```

Без `confirm: true` вернёт 400 с предупреждением.

```json
{ "ok": true, "channel": "IN1", "on": true, "via": "hid",
  "frames": 1, "stateKnown": false }
```

`stateKnown: false` — честный признак, что подтвердить включение
нельзя. Состояние хранится у клиента.

---

## Loopback и Ducking — запись в устройство

До 2026-11-10 этих маршрутов не было: состояние только хранилось
в файле. Протокол записи проверен скриптом-пробой, теперь вынесен
в бекенд.

**Ограничение:** обратного чтения нет (`IN=0` во всех захватах).
Запись принимается, но подтвердить применение можно только захватом
USBPcap. Поэтому ответ содержит `applied: "unknown"` — это честно,
а не «ok».

### `POST /api/ducking`

```json
{ "values": { "switch": 0, "threshold": -30, "attack": 200, "reduction": 16, "release": 1000 } }
```

Параметры: `threshold` (−60..0 дБ), `attack` (1..500 мс),
`reduction` (0..60 дБ), `release` (1..3000 мс), `maskLo`/`maskHi`
(маска входов по битам, 0..255), `switch` (0/1).

```json
{ "ok": true, "via": "hid", "frames": 2, "applied": "unknown" }
```

Значения заодно сохраняются в своё хранилище.

### `POST /api/loopback`

Одна пара:

```json
{ "pair": "lb12", "source": "FX", "gainDb": 0 }
```

Несколько сразу:

```json
{ "pairs": { "lb12": { "source": "FX", "gainDb": 0 },
             "lb34": { "source": "Mix A", "gainDb": -6 } } }
```

`source` принимает и имя (`FX`, `Mix A`, `Playback 1/2`), и код
(`17`, `1`, `12`). `gainDb` — в дБ, −90 и ниже пишется как mute.

```json
{ "ok": true, "via": "hid", "frames": 3, "pairs": {...}, "applied": "unknown" }
```

### `GET /api/duck-loopback`

Справочник: адреса, коды источников, шкала Q25.

---

## Состояние, которое нельзя прочитать из устройства
Микшер, loopback и ducking **не читаются из HID** — проверено, `IN=0`
во всех захватах. Значит их состояние надо хранить самим.

Раньше им был workspace-INI MCC, из-за чего 7 маршрутов падали без
установленного M Control Center. Теперь это отдельный JSON:

```
%APPDATA%\m62\state.json
```

**MCC не нужен ни запущенным, ни установленным.**

### `GET /api/state`

Сводка хранилища.

```json
{ "ok": true,
  "dir": "C:\\Users\\<user>\\AppData\\Roaming\\m62",
  "file": "...\\state.json",
  "version": 1, "updatedAt": "2026-11-10T13:09:12.824Z",
  "source": "imported from MCC workspace",
  "mixer": { "buses": ["A","B","C","D","E"], "sources": 50, "lastWrittenAt": null },
  "loopback": { "pairs": 4, "lastWrittenAt": null },
  "ducking": { "keys": 8, "lastWrittenAt": null },
  "prefs": 0 }
```

### `GET /api/state/full`

Полное содержимое, включая матрицу микшера.

### `POST /api/state/import`

Однократный импорт из workspace MCC — для перехода со старого способа.
Если состояние уже заполнено, ничего не затирает.

```json
{ "ok": true, "imported": true,
  "mixerBuses": 5, "loopbackPairs": 4, "duckingKeys": 8 }
```

### `POST /api/state/mixer`

Сохранить матрицу микшера в своё хранилище (без записи в устройство).

```json
{ "buses": { "A": { "PB12": 0, "IN12": -6 } } }
```

Запись в само устройство — отдельно, через `POST /api/mixer`
(он требует полную матрицу, потому что микшер пишется одним пакетом).

### `POST /api/state/loopback`

Сохранить loopback в своё хранилище.

```json
{ "pairs": { "lb12": { "source": 17, "gain": 0 } } }
```

### `POST /api/state/ducking`

Сохранить параметры ducking в своё хранилище.

```json
{ "values": { "switch": 0, "threshold": -30 } }
```

---

### `GET /api/mixer`

Карта микшера: источники, шины, блоки, порядок групп, шкала.

```json
{
  "ok": true,
  "sources": [
    { "id": "pb12", "name": "Playback 1/2", "prop": 1,
      "propHex": "0x01", "stereo": true, "propR": 2,
      "code": 12, "codeVerified": true }
  ],
  "buses": [
    { "id": "a", "name": "Mix A", "l": 49, "r": 50,
      "lHex": "0x31", "rHex": "0x32" }
  ],
  "scale": { "kind": "Q25", "unity": 33554432, "half": 16777216,
             "unityDb": 0, "halfDb": -6.02, "mute": 0 },
  "notes": ["..."]
}
```

### `POST /api/mixer`

Записать матрицу микшера. Отправляет 200 кадров внутри bulk push.

```json
{
  "state": {
    "b": { "pb12": -6, "in1": -3 },
    "c": { "aux": -12 }
  }
}
```

Ответ:

```json
{ "ok": true, "frames": 200 }
```

| поле | тип | обязательно | смысл |
|---|---|---|---|
| `state` | object | да | `{ шина: { источник: дБ } }` |
| `announce` | boolean | нет | запросить дамп после записи (по умолчанию `true`) |

Неуказанные источники в шине ставятся в **mute** (`0`), а не остаются
как были. Указывайте полное желаемое состояние шины.

> ⚠️ При работающем M Control Center запись будет откачена: MCC при старте
> отправляет свою матрицу из workspace-INI.

---

## EQ наушников

> **Только в Prof-режиме.** В Live и Mobile блоков `0xa1..0xaa` не существует.

10 полос × 2 канала. Структура идентична EQ входов, но полос в 2.5 раза
больше, и они на наушники. См. [`EQ-HP.md`](EQ-HP.md).

### Как устроено

```
0xa1 = полоса 1 … 0xaa = полоса 10
свойства 01..05 = ЛЕВЫЙ канал
свойства 06..0a = ПРАВЫЙ канал

  01 / 06  вкл-выкл полосы      0/1
  02 / 07  тип фильтра          1 = peaking
  03 / 08  gain, дБ
  04 / 09  частота, Гц
  05 / 0a  Q × 10000
```

### `GET /api/eq-hp`

Текущее состояние всех 10 полос.

```json
{
  "ok": true,
  "mode": "Prof",
  "available": true,
  "bandCount": 10,
  "bands": [
    {
      "band": 1,
      "l": { "enable": 0, "type": 1, "gain": 40, "freq": 632, "q": 7000 },
      "r": { "enable": 0, "type": 1, "gain": 40, "freq": 632, "q": 7000 }
    }
  ]
}
```

Если режим не Prof: `available: false`, `bands: []`.

### `POST /api/eq-hp`

Записать параметры одной полосы.

```json
{
  "band": 1,
  "l": { "enable": 1, "gain": -6, "freq": 1000, "q": 7070 },
  "r": { "enable": 1, "gain": -6 }
}
```

Ответ:

```json
{ "ok": true, "band": 1, "frames": 5 }
```

| поле | обязательно | смысл |
|---|---|---|
| `band` | да | 1..10 |
| `l` | нет | левый канал: любые из `enable/type/gain/freq/q` |
| `r` | нет | правый канал, то же |

Можно указывать только нужные поля — остальные не трогаются.

### ⚠️ Тайминг

В Prof-режиме эти блоки приходят **поздно**:

```
подписка -> ... -> 0x91 на 18.8 с -> 0xa1 на 18.9 с
```

Поэтому:
- сервер шлёт повторный `0x11:0x26` каждые 15 с (иначе EQ не приходит);
- **M Control Center перехватывает поток** — при работающем MCC сервер
  получит только 13 семейств без `0x91`/`0xa1`.

Если `GET /api/eq-hp` возвращает `mode: "Mobile"` при реальном Prof —
закрой MCC и перезапусти бекенд.

---

## Метры уровня

### `GET /api/meters`

Последние значения всех метров в дБ — одним запросом, без WebSocket.

```json
{
  "ok": true,
  "scale": { "divisor": 10, "unit": "dB", "min": -90.2, "max": 0, "floorRaw": -902 },
  "meters": [
    { "id": "meter_IN1", "name": "Meter IN1", "tag": "0x2101",
      "raw": -661, "db": -66.1, "atFloor": false, "noData": false, "ageMs": 28 }
  ],
  "gainReduction": {
    "db": -9.5, "beforeDb": -80.7, "afterDb": -90.2,
    "note": "отрицательное = компрессор сжимает"
  }
}
```

### Шкала

Сырое значение приходит как int16 со знаком в **десятых долях dB**:

```
dB = raw / 10
```

**Пол шкалы −90 dB** (`raw = −902`). Ниже метр не опускается: при
замьюченном входе стабильно приходит ровно `−902`.

Измерено (NOTES §114):
- наклон в рабочей области — **10.0 raw/дБ**, стабильно на интервалах 8 дБ;
- пол `−902/10 = −90.2 dB`;
- на больших интервалах (30–60 дБ) кажущийся наклон падает до 6–7 — это
  **артефакт пола** (нижняя точка обрезана), а не реальная кривая.

Флаги:
- `atFloor: true` — метр на полу, реальный уровень ниже либо равен −90 dB;
- `noData: true` — тег присутствует в потоке, но значения не несёт
  (`comp10` всегда 0);
- `ageMs` — сколько миллисекунд назад пришло последнее значение.

### Метры компрессора

| тег | роль |
|---|---|
| `0x460c` `comp12` | уровень **до** компрессора |
| `0x460d` `comp13` | уровень **после** компрессора |
| `0x4609` `comp9` | **константа −800**, не меняется никогда — не метр |
| `0x460a` `comp10` | всегда 0, канал не используется |

`gainReduction.db = (afterRaw − beforeRaw) / 10` — отрицательное значение
означает, что компрессор сжимает.

Проверено: при `Threshold=0`, `Ratio=∞`, усилении mic1=80 —
до включения `comp12=−596 comp13=−679`, после `comp12=−623 comp13=−733`,
редукция **−54 raw = −5.4 dB**.

**Чего в HID нет:** индикатор `compressMeter` из окна `COMP`
(`QProgressBar`, RangeValue 0..360) **всегда 0**, даже при работающем
сжатии. Это чисто визуальный элемент MCC, значения не отдаёт.

---

## Снимки состояния

Своя реализация полного снапшота — **в MCC такого нет**.

Полный снимок «всё сразу» вендорское приложение не умеет:
HID-пресеты хранят только аудио-состояние, микшер и EQ живут в файле,
настройки устройства не хранит никто.

### `GET /api/snapshots`

```json
{ "ok": true, "list": [
  { "file": "snap_2026-11-07T01-39-29_test1.json", "label": "test1",
    "at": "2026-11-07T01:39:29.015Z", "hidCount": 38, "hasWorkspace": true }
] }
```

### `POST /api/snapshots`

```json
{ "label": "before-change" }
```

### `GET /api/snapshots/get?file=...`

### `GET /api/snapshots/diff?a=...&b=...`

```json
{ "ok": true, "diff": {
  "hid": [{ "key": "0x2104", "from": 20, "to": 5 }],
  "workspace": ["inputs", "mixer"]
} }
```

### `POST /api/snapshots/apply`

```json
{ "file": "snap_...json" }
```

Применяет HID-часть и файловую часть одним перезапуском MCC.

```json
{ "ok": true, "hidApplied": 26, "workspaceApplied": 133, "skipped": 10 }
```

**Что пропускается:** параметры-команды (`0x11:0x08/0x0b/0x0e/0x12/0x1d`,
сцены `0x45:*`), счётчик `0x11:0x18/0x19`, метры, и ключи, которых нет
в текущем workspace-файле.

**⚠️ Формат ключей `hid` — ШЕСТНАДЦАТЕРИЧНЫЙ:** `"11:04"`, `"44:01"`,
`"21:04"`. Не десятичный.

**Ограничение:** компрессор и реверб снимком не восстанавливаются —
Ratio/Attack/Release/Mix только через `Load preset`, реверб только через
`POST /api/reverb`.

**Проверено end-to-end:** снимок 4 параметров (brightness, MixA_GAIN,
Output_HP.GAIN, EQ-полоса) восстановился точно — 4/4.

### `POST /api/snapshots/delete`

---

## WebSocket

`ws://127.0.0.1:8787/ws`

### При подключении

```json
{
  "type": "hello",
  "connected": true,
  "controls": { ... },
  "eqMixer": { ... },
  "mode": { "mode": "Live", "confidence": "high", "capabilities": { ... } },
  "protocol": {
    "frameLen": 15,
    "reportLen": 16,
    "keepaliveMs": 2000,
    "crc": "CRC-16/MODBUS",
    "sessionHandshake": "0x11:0x01 = 1",
    "handshakeRequired": true
  }
}
```

> **`handshakeRequired: true`** — session handshake `0x11/0x01 = 1`
> отправляется транспортом автоматически при подключении. Без него
> устройство отдаёт 44 параметра вместо 96…102: компрессор и EQ-полосы
> не приходят вообще. Фронту ничего делать не нужно, но это объясняет,
> почему блоки эффектов появляются не мгновенно.

`mode` приходит сразу — фронт знает, что доступно, ещё до первого запроса.

### Команда `getState`

Возвращает **полный контекст** одним сообщением:

```json
{
  "type": "state",
  "connected": true,
  "controls": { "volumes": [...], "selectors": [...], "sources": [...] },
  "settings": { "toggles": [...], "enums": [...], "commands": [...] },
  "workspace": { "available": true, "inputs": [...], "mixer": [...], "eq": [...] },
  "mode": { "mode": "Live", "capabilities": { ... } },
  "counts": { "volumes": 7, "selectors": 2, "mixerChannels": 10, "eqBlocks": 2 }
}
```

**Проверено: 14/14** (`node src/tools/test-websocket.js`).

### События от сервера

```json
{ "type": "event", "kind": "meter",  "id": "meter_IN1",   "value": -355, "transient": true }
{ "type": "event", "kind": "volume", "id": "hp",          "value": 50, "db": -20.5 }
{ "type": "event", "kind": "setting","id": "brightness",  "value": 2, "label": "Bright" }
{ "type": "event", "kind": "jack",   "id": "hpPresent",   "value": 1 }
{ "type": "event", "kind": "fx",     "id": "fxIn1Level",  "value": 3 }
{ "type": "event", "kind": "comp",   "id": "compThreshold", "value": -18 }
{ "type": "event", "kind": "duck",   "id": "duckSwitch",  "value": 1 }
{ "type": "event", "kind": "eq",     "id": "eqIn1Switch", "value": 0 }
{ "type": "ack", "op": "volume", ... }
{ "type": "device", "connected": false, "reason": "ENODEV" }
{ "type": "error", "message": "..." }
```

**Типы событий:** `meter`, `volume`, `outputMute`, `selector`, `setting`,
`status`, `jack`, `fx`, `comp`, `duck`, `eq`, `eqBand`, `identity`, `unknown`.

> **`outputMute`** — теги `0x6404` (наушники, `hpMute`) и `0x6204`
> (OTG, `otgMute`). Приходят во второй волне ANNOUNCE (~5.3 с).
>
> **Раньше эти теги ошибочно назывались «playback volume»** —
> громкость выходов живёт в `0x03` (`0x6303`/`0x6403` наушники,
> `0x6103`/`0x6203` OTG), а `0x04` в таблице mainline-драйвера вообще
> не упомянут.
>
> **Статус — гипотеза.** Читать значение можно: запись `1` устройство
> принимает и возвращает её на следующем ANNOUNCE
> (`src/tools/probe-mute-rw.js`). Но запись `0x04 = 1` **не**
> переключила кнопку MUTE в UI MCC, а UI-переключение не сдвинуло тег
> (`src/tools/mute-vs-tag.js`, тест нечистый: UI-мьют не держался).
> Эталон состояния мьюта — по-прежнему `TogglePattern` в UI,
> а не этот тег.

> **Метры (`transient: true`)** — это шум, не состояние. Их приходит
> большинство событий. Фронту нужен отдельный канал/буфер для них.

### ⚠️ Устройство НЕ присылает эхо своих значений

Проверено: если записать громкость (`0x64:0x03`), микшер или другое
значение, **устройство не сообщит об этом обратно**. Оно присылает
события только о том, что изменили **физически** (ручка, джек).

| тип | эхо от устройства |
|---|---|
| громкости (`0x2x`, `0x6x`) | **НЕТ** |
| настройки (`0x11`) | **да** |
| метры | да (постоянный поток) |

**Поэтому бекенд создаёт событие `volume` сам** после успешной записи —
иначе другие клиенты не узнают об изменении.

> **Для мультиклиентности:** открывайте несколько вкладок и меняйте
> громкость в одной — остальные получат `{type:"event", kind:"volume"}`.
> Проверено: клиент A видит изменения от клиента B.

**Другие параметры без события:** микшер, EQ, loopback, outputs, ducking
(они в файле, устройство про них не знает). После `POST /api/workspace/apply`
фронту нужно перечитать `/api/workspace`.

### Команды от клиента

Все команды возвращают `ack` с тем же `op`, либо `error`.
Проверено: **17/17** (`node src/tools/test-websocket.js`).

```json
{ "type": "setVolume",   "id": "hp", "value": 50 }
{ "type": "setSelector", "id": "hpSource", "index": 10 }
{ "type": "getState" }
```

**Настройки устройства** (toggle или enum — различаются флагом `enum`):

```json
{ "type": "setSetting", "id": "bluetooth",  "value": 1 }
{ "type": "setSetting", "id": "brightness", "value": 2, "enum": true }
```

**Команды** (пресеты, сцены, сброс):

```json
{ "type": "runCommand", "id": "loadPreset1" }
{ "type": "runCommand", "id": "sceneChat" }
{ "type": "runCommand", "id": "restoreDefault", "confirm": true }
```

**Реверб:**

```json
{ "type": "setReverb", "reverbType": "STUDIO" }
```

Допустимо: `STUDIO`, `LIVE`, `HALL`, `Bypass`. Требует запущенного MCC.

> **Замечание:** `setVolume`/`setSelector` рассылают `ack` **всем** клиентам
> (`broadcast`), а `getState` отвечает только запросившему.
> Остальные команды тоже рассылают `ack` всем — это позволяет синхронизировать
> несколько открытых вкладок, но фронт должен фильтровать по `op` и `id`.

---

## Обработка ошибок

**Все ошибки — HTTP 400 с JSON, бекенд никогда не падает.**

```json
{ "ok": false, "error": "значение вне диапазона 0..99: 9999" }
```

Проверено на 20 сценариях (`node src/tools/test-robustness.js` → **20/20**):

| ситуация | ответ |
|---|---|
| неизвестный `id` громкости/настройки/команды | 400 |
| значение вне диапазона | 400 |
| нечисловое значение (`"abc"`) | 400 |
| `restoreDefault` без `confirm: true` | 400 «команда необратима» |
| неверная секция в workspace | 400 «секция не найдена» |
| неверный тип реверба | 400 |
| несуществующий эндпоинт | 404 |
| запись при закрытом устройстве | 400 |
| **M Control Center не запущен** (реверб/компрессор) | 400 «M Control Center не запущен — это действие требует его» |

**После серии ошибок бекенд продолжает работать** — состояния залипания нет.

### Работа без M Control Center

Все 11 GET-эндпоинтов и запись через HID **работают без MCC**.
Проверено (`test-no-mcc.js` → 11/11).

Не работают только два действия — реверб и компрессор (они через UI MCC).
Для них возвращается понятная ошибка.

### Отключение устройства

`POST /api/disconnect` → устройство отпущено **окончательно** (автовосстановления
не будет), но:
- `health` покажет `connected: false`
- `controls`, `workspace`, `mode` продолжают отдавать данные
  (описание статично, workspace — файл на диске)
- любая запись вернёт 400

`POST /api/connect` возвращает всё назад.

### ⚡ Автовосстановление при выдёргивании кабеля

Если кабель выдернули **физически** (или устройство иначе пропало),
бекенд переподключается сам — экспоненциальная задержка 1 → 2 → 4 → … → 10 с,
до 30 попыток.

При восстановлении приходит:

```json
{ "type": "device", "connected": true, "autoReconnected": true }
```

**Проверено:** после потери устройство возвращается само, поток данных
восстанавливается (1024 чтения за 2 с).

> **Разница:** `POST /api/disconnect` — это **явная** команда человека,
> автовосстановления не будет. Потеря кабеля — восстанавливается.

---

## Ограничения, которые надо знать фронту

1. **Режим меняет состав функций** — см. `/api/mode`.
2. **Селекторы не читаются** — только записать и помнить.
3. **Запись в workspace = перезапуск MCC (17 с).** Показывайте прогресс.
4. **Компрессор задаётся с погрешностью ±3–5** (через dial).
5. **Пресеты частичные** — восстанавливают не всё.
6. **Метры — основной поток.** Не рисуйте их как обычные события.
7. **Устройство не подтверждает запись** — ACK нет.
8. **Смена режима перезагружает устройство** на 1–8 секунд.

---

## Инструменты

| команда | что делает |
|---|---|
| `node src/tools/verify-coverage.js` | **42 проверки** всех функций |
| `node src/tools/selftest.js` | самопроверка транспорта |
| `node src/tools/read-settings.js` | прочитать настройки с устройства |
| `node src/tools/capture-restart.js` | перехват старта MCC |
| `node src/tools/set-device-mode.js Live\|Prof\|Mobile` | сменить режим |
| `node src/tools/dump-hid-families.js` | состояние HID по семействам |
| `node src/tools/inventory-workspace.js` | все ключи всех workspace |

---

## Статус

**Проверено на живом устройстве: 42/42.**

| функция | статус |
|---|---|
| Громкости (7), селекторы (2), источники (15) | работает |
| Настройки устройства (bluetooth, brightness, power, кнопки) | работает |
| Микшер (10 каналов × 5 шин × 16 полей) | работает |
| EQ (2 × 4 полосы + EQ_HP 10 полос) | работает |
| Loopback (4), Outputs (2) | работает |
| Ducking, эффекты | работает |
| Реверб (4 типа) | работает |
| Компрессор (Switch + параметры через UI) | работает |
| Сцены (Chat/Vocal) | работает |
| Пресеты (частичные) | работает |
| Сброс к заводским | работает |
| Снимки состояния | работает |
