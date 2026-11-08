# WEBHID: МОЖНО ЛИ ПОДКЛЮЧИТЬ M62 НАПРЯМУЮ ИЗ CHROME

Дата: 2026-11-07, раунд 15.
Метод: чтение HID-дескриптора через `HidP_GetCaps` + анализ требований WebHID.

---

## 1. ЧТО ПОКАЗАЛ ДЕСКРИПТОР

```
VID=152A PID=875C ver=0248 product='M62'
  UsagePage = 0x01   (Generic Desktop)
  Usage     = 0x00   (нестандартный!)
  InputReportByteLength   = 17
  OutputReportByteLength  = 17
  FeatureReportByteLength = 0
  path=\\?\hid#vid_152a&pid_875c&rev_0248&mi_04#...
```

Только один HID-интерфейс — `mi_04` (interface 4).

---

## 2. ТЕХНИЧЕСКАЯ СОВМЕСТИМОСТЬ: ДА

| требование WebHID | M62 | замечание |
|---|---|---|
| устройство видно как HID | **да** | `mi_04` |
| VID/PID для фильтра | **да** | `0x152A` / `0x875C` |
| input reports | **17 байт** | лимит 65535 — ок |
| output reports | **17 байт** | ок |
| feature reports | **0** | `sendFeatureReport` не работает — но он не нужен |
| протокол простой | **да** | 15-байтовый кадр + CRC |

**Фильтр для `navigator.hid.requestDevice()`:**

```js
// надёжный вариант
const [device] = await navigator.hid.requestDevice({
  filters: [{ vendorId: 0x152a, productId: 0x875c }]
});

// вариант по usage, скорее всего НЕ сработает (Usage = 0x00)
// { usagePage: 0x01, usage: 0x00 }
```

**Работа с устройством:**

```js
await device.open();

// отправка: report id 0, 16 байт данных
// (кадр 15 байт + 1 байт pad, как в транспортном коде)
const frame = new Uint8Array(16);   // 15 байт кадра + pad
await device.sendReport(0, frame);

// чтение
device.addEventListener('inputreport', (e) => {
  const data = new Uint8Array(e.data.buffer);  // 17 байт
  // data[0] = report id, data[1..15] = кадр, data[16] = pad
});

// подписка и keepalive
await device.sendReport(0, buildFrame(0x11, 0x24, 1));  // subscribe
setInterval(() => device.sendReport(0, buildFrame(0x11, 0x24, 1)), 2000);
```

---

## 3. РЕАЛЬНЫЕ ПРОБЛЕМЫ

### 3.1 Конфликт за устройство

Если **M Control Center запущен**, он держит устройство. WebHID может
не открыть его на запись.

Проверено: HID открывается **вторым читателем** параллельно с MCC
(так снимались все данные), но это чтение. С записью конфликт вероятнее.

**Вывод: для WebHID M Control Center должен быть закрыт.**

### 3.2 Keepalive 2 секунды в фоновой вкладке

Устройство замолкает, если подписку не продлевать каждые 2 с.
Chrome **душит таймеры в фоновых вкладках** (throttling до 1 раза в минуту).
Keepalive сорвётся → поток событий прекратится без предупреждения.

**Обход:** держать вкладку активной, либо использовать Web Worker
(таймеры там тоже душатся, но меньше), либо бекенд.

### 3.3 Usage = 0x00 нестандартный

Фильтр по `usagePage`/`usage` может не сработать. Работает только
фильтр по VID/PID.

**Следствие:** в диалоге выбора устройства Chrome покажет M62,
но без описания (usage не даёт человекочитаемого имени).

### 3.4 Только Chrome и Edge

Firefox и Safari WebHID **не поддерживают**. Это отсекает часть аудитории.

### 3.5 HTTPS или localhost

WebHID работает только в безопасном контексте. Для локального клиента —
`localhost` подходит.

### 3.6 Нет доступа к workspace-файлам

**Самое важное ограничение.** WebHID даёт только HID-канал. А микшер, EQ,
loopback, outputs, компрессор — живут в INI-файлах на диске
(см. `research/WORKSPACE.md`).

**Через WebHID их НЕ ДОСТАТЬ и НЕ ЗАПИСАТЬ.**

То есть браузерный клиент на WebHID сможет:
- читать громкости, селекторы, метры, джеки, настройки устройства;
- писать громкости, селекторы, настройки, FX-уровни.

И **не сможет**:
- микшер, EQ, loopback, outputs, компрессор, реверб.

---

## 4. СРАВНЕНИЕ ПОДХОДОВ

| | WebHID (браузер) | Бекенд (Node) |
|---|---|---|
| Громкости, селекторы, метры | **да** | да |
| Настройки устройства | **да** | да |
| Микшер, EQ, loopback | **нет** | да (через файл) |
| Компрессор, реверб | **нет** | да (через UI MCC) |
| Работа в фоне | **нет** (throttling) | да |
| Firefox/Safari | **нет** | да (через HTTP) |
| Установка | **не нужна** | нужен Node |
| Конфликт с MCC | **есть** | нет (MCC может работать) |

---

## 5. ВЫВОД

**WebHID технически возможен, но даёт только ~40% функционала.**

Через него доступен HID-канал: громкости, селекторы, метры, настройки,
FX-уровни. Недоступно всё, что живёт в workspace-файле и UI MCC —
микшер, EQ, loopback, компрессор, реверб.

**Рекомендация:**

1. **Основной путь — бекенд** (Node), фронт общается по HTTP/WebSocket.
   Это даёт 100% функционала и работает во всех браузерах.

2. **WebHID — как бонус «без установки»** для быстрого просмотра
   (громкости, метры, настройки), с честным предупреждением,
   что микшер и EQ недоступны.

3. **Гибрид невозможен** для одного устройства: нельзя одновременно
   держать HID в браузере и в бекенде с записью.

---

## 6. ЧТО УЖЕ ГОТОВО ДЛЯ ФРОНТА

Бекенд отдаёт всё по HTTP/WS — фронт может быть любым:
React, Vue, Svelte, ванильный JS. Ничего специфичного для Chrome не нужно.

11 эндпоинтов:
```
GET  /api/health          GET  /api/controls
GET  /api/device          GET  /api/settings
GET  /api/tags            GET  /api/workspace
GET  /api/workspaces      GET  /api/eq-mixer
GET  /api/ui-controls     GET  /api/snapshots
GET  /api/mode
POST /api/volume          POST /api/selector
POST /api/settings/toggle POST /api/settings/enum
POST /api/settings/command
POST /api/workspace/apply POST /api/reverb
POST /api/snapshots       POST /api/snapshots/apply
WS   /ws
```
