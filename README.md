# M62 Web Client

Замена **M Control Center** для аудиоинтерфейса TOPPING M62:
сервер на Node.js + веб-клиент, который общается с картой **напрямую
из браузера** через WebHID, без установки ПО.

---

## Что готово

| часть | состояние |
|---|---|
| **Веб-клиент (WebHID)** | **работает**: EQ входов и наушников, микшер, сцены, mutes, loopback, батарея |
| Сервер + API (61 маршрут) | работает; для веб-клиента **не нужен** |
| Протокол | **расшифрован полностью** (см. ниже) |
| Прошивка | **разбирается** в Ghidra (xCore XS3, XMOS XU316) |
| Железо | **опознано полностью**: 2× ES9821Q, AK7604, STM32G070, батарея |

### Почему протокол считаем полным

Независимо от нас полный протокол M62 опубликован в mainline Linux:
серия патчей v10, драйверы `hid-topping` + `mixer_topping.c`,
2280 строк. Наши выводы совпали с ним там, где пересекались.
См. [research/LINUX-DRIVER.md](research/LINUX-DRIVER.md).

---

## Быстрый старт

```bash
npm install
npm start
# http://127.0.0.1:8080/
```

Открыть в Chrome или Edge 89+, нажать «Подключить», выбрать M62.
MCC при этом должен быть закрыт.

Сервер нужен только чтобы **отдать файлы страницы**. Само управление
идёт через WebHID прямо из браузера.

---

## Что умеет веб-клиент

- выходы: громкость и mute наушников, mute OTG, кнопка «Заглушить»
- усиление 5 входов (правильные шкалы в дБ, а не сырые шаги)
- 48 В на IN1/IN2 с подтверждением
- реверб: тип + dry/wet, room, decay, width
- компрессор: 6 параметров
- **EQ входов**: IN1/IN2, 4 полосы, все 5 свойств (вкл, тип, gain, частота, Q)
- **EQ наушников**: 10 полос × 2 канала (только режим Prof)
- **микшер**: 5 шин × 11 источников
- **mutes**: 7 переключателей входов и выходов
- **loopback**: 4 возврата — гейн и источник
- **сцены**: сохранить/загрузить/удалить в `localStorage`
- **батарея**: заряд в процентах
- **режим**: Mobile / Live / Prof определяется мгновенно

---

## Чего нельзя и почему

| что | почему |
|---|---|
| Прочитать микшер с карты | карта **не отдаёт** его — 1600 записей, 0 чтений |
| Прочитать loopback и ducking | то же: только запись |
| Прочитать селекторы источников | карта их не сообщает |
| Подтвердить запись микшера | метры живые, но только при идущем звуке |
| Включить `Mic Capture Switch` | это UAC-контрол, через HID недоступен |
| Обновить прошивку | запись через DFU не воспроизведена, риск кирпича |

Там, где карта не отдаёт состояние (микшер, loopback), интерфейс
работает на **нашей модели** в `localStorage` и честно об этом
предупреждает.

---

## Документация

### Начать отсюда

| файл | о чём |
|---|---|
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | **как развернуть сайт** (хостинг, HTTPS, Docker) |
| **[docs/WEB-CLIENT.md](docs/WEB-CLIENT.md)** | главный документ: архитектура, правила протокола, что проверено |
| [research/CONTROLS-MAP.md](research/CONTROLS-MAP.md) | **полная карта контролов** из драйвера ядра |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | формат кадра, теги, CRC |

### Протокол и устройство

| файл | о чём |
|---|---|
| [research/LINUX-DRIVER.md](research/LINUX-DRIVER.md) | опубликованный драйвер ядра: что подтвердилось, что нового |
| [research/UCM-ARCHITECTURE.md](research/UCM-ARCHITECTURE.md) | архитектура карты: 10 каналов playback = 5 стерео-шин, 16 capture |
| [docs/MIXER.md](docs/MIXER.md) | микшер: структура, почему не читается |
| [docs/EQ-HP.md](docs/EQ-HP.md) | EQ наушников: 10 полос × 2 канала |

### Реверс прошивки

| файл | о чём |
|---|---|
| **[research/FIRMWARE-REVERSE.md](research/FIRMWARE-REVERSE.md)** | **архитектура найдена**: xCore XS3, разбирается в Ghidra |
| [research/HARDWARE.md](research/HARDWARE.md) | **полный список чипов** (из разборки на ASR) |
| [research/CAPABILITIES.md](research/CAPABILITIES.md) | **итог: что можем, что недоступно** |
| [research/BOARD-PHOTOS.md](research/BOARD-PHOTOS.md) | плата: что где стоит |
| [research/ASR-THREAD-2.md](research/ASR-THREAD-2.md) | вторая ветка ASR: дескрипторы Linux, factory reset |
| [research/FEASIBILITY.md](research/FEASIBILITY.md) | что можно и чего нельзя с прошивкой |
| [research/PROGRAMMERS.md](research/PROGRAMMERS.md) | CP2102/FT232RL: что подходит для флеша, а что нет |

### Железо и внешние данные

| файл | о чём |
|---|---|
| [research/ASR-THREAD.md](research/ASR-THREAD.md) | 8 страниц обзора ASR: порты, каналы, режимы, замеры |
| [research/board-photos/](research/board-photos/) | фото платы и кропы чипов |

### API (если понадобится сервер)

| файл | о чём |
|---|---|
| [docs/API.md](docs/API.md) | 61 маршрут |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | как устроен сервер |

### История

| файл | о чём |
|---|---|
| [research/NOTES.md](research/NOTES.md) | журнал измерений (570 КБ, всё что проверялось) |
| [research/archive/](research/archive/) | одноразовые скрипты (492 шт.) |

---

## Тесты

```bash
# без устройства
node src/tools/test-ui-frames.js        # 66/66  кадры управления
node src/tools/test-gain-scales.js      # 35/35  шкалы гейнов
node src/tools/test-mutes-loopback.js   # 42/42  mutes и loopback
node src/tools/test-scenes.js           # 35/35  сцены
node src/tools/check-page-script.js     # 16/16  синтаксис страницы

# нужен сервер на 8898
$env:M62_PORT='8898'; node src/server.js
node src/tools/check-page-render.js --port 8898   # 20/20  рендер
node src/tools/test-browser-modules.js --port 8898 # 22/22 без Node
node src/tools/test-robustness.js                  # 20/20 надёжность
node src/tools/audit-docs.js                       # 61 = 61

# на живой карте
node src/tools/test-transport-core.js   # 5/5
node src/tools/prove-eq-in2-live.js     # 5/5  EQ входов
node src/tools/prove-eq-hp-live.js      # 8/8  EQ наушников
```

---

## Структура

```
src/                  сервер и модули протокола
  protocol.js         кадры, CRC
  transport-core.js   политика протокола (для браузера)
  transport.js        вторая реализация (для сервера)
  adapter-webhid.js   WebHID
  adapter-nodehid.js  node-hid
  mutes-loopback.js   mutes, loopback, селекторы
  gain-scales.js      шкалы громкости в дБ
  modes.js            определение режима
  server.js           HTTP + WS API
  tools/              50 активных скриптов (остальное в research/archive/)
web/                  клиент: index.html, mixer-state.js, scenes.js
docs/                 документация
research/             исследования, заметки, архив
  board-photos/       фото платы
  ghidra-scripts/     скрипты для Ghidra
  firmware/           образ прошивки
  xmos-samples/       эталон XU316 для сравнения
  archive/tools/      492 исторических скрипта
  external/           чужие материалы (REA), не про M62
```

---

## Что дальше

Открытые задачи — в [docs/WEB-CLIENT.md](docs/WEB-CLIENT.md) §12.
Коротко:

1. **Прошивка**: разметить функции в дизайнере, разобрать таблицы DSP.
2. **Подтверждение микшера**: нужен звук на карте, чтобы увидеть метр.
3. **`Mic Capture Switch`**: только через доступ к ОС, не через HID.


