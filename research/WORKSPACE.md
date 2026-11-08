# WORKSPACE-ФАЙЛЫ MCC — то, чего нет в HID

**Открытие раунда 2.** Микшер, EQ, 48V, MIC, loopback и часть эффектов
**не идут через HID-протокол**. Они живут в INI-файле workspace, который
M Control Center ведёт в реальном времени.

Дата: 2026-11-07. Проверено на живом устройстве и живом MCC.

---

## 1. Где лежат файлы

```
C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\
  ├─ Live\   M62_Live_<name>.ini     <- режим Live streaming
  ├─ Prof\   M62_Prof_<name>.ini     <- режим Pro audio
  ├─ Mble\   M62_Mble_<name>.ini     <- режим Mobile
  └─ Tyro\   M62_Tyro_<name>.ini
```

Имя workspace — то, что выбрано в выпадающем списке «Workspace» в UI.

### 1.1 Как определить активный workspace — ДВА СПОСОБА

**Способ 1: по `mtime` (самый свежий файл).** Работает, но файл может
быть тронут посторонним действием.

**Способ 2: по реестру — надёжнее.**

```
HKCU\Software\TOPPING\TOPPING Professional Control Center\M62
   M62_Live_Workspace = ввв              <- имя активного workspace в Live
   M62_Prof_Workspace = 2026-1009-2347-04
   PageID             = 3
   PageLiveFactor1/2  = {..}
   PageLiveWidth      = 1650
```

Реализовано: `findActiveWorkspaceFromRegistry(mode)` в `src/workspace.js`.
Проверено 2026-11-07 — оба способа дали `Live/ввв`.

**В реестре пресетов НЕТ** — только имена workspace и состояние UI.

**Важно:** файл `M62_Live_main.ini` может быть НЕ активным. Активным был
`M62_Live_ввв.ini` — при том, что `main` выглядел «главным».

---

## 2. Структура файла

```ini
[ConfigFileHeader]
DeviceName=M62_Live
CreateUser=rulled
CreateDate=2026-10-07 15:03:18

[Ducking]
Ducking=true
ChannelName=IN 1+2
DuckingSwitch=0
Threshold=-30
Attack=200
Reduction=16
Release=1000
IN1AUX=true          <- карта: какие входы триггерят ducking
IN2AUX=true
... (IN1/IN2 × AUX/BT/OTGIN/Playback1_2..9_10)

[FieldInput]
Visible=IN 1, IN 2, AUX, BT, OTG IN

[Input_IN1]
ChannelName=IN 1
MIC=Mic1             <- тип микрофона
48V=0                <- ФАНТОМНОЕ ПИТАНИЕ
SOLO=false
MUTE=0
GAIN=55
Balance=100

[Input_IN2] ... [Input_AUX] ... [Input_BT] ... [Input_OTGIN]

[FieldMixer]

[Mixer_IN12]
ChannelName=IN
MixA_GAIN=0          <- усиление в шину A
MixA_SOLO=false
MixA_MUTE=false
MixB_GAIN=0
... (MixA..MixE)

[Mixer_AUX] [Mixer_BT] [Mixer_OTGIN] [Mixer_FX]
[Mixer_PB12] [Mixer_PB34] [Mixer_PB56] [Mixer_PB78] [Mixer_PB910]

[FieldEffect]

[Effect_Integration]
NoiseReductionNC1=35
NoiseReductionNC2=30
NoiseReductionBypass=35
NoiseReductionType=NC1
ReverbStudio=4
ReverbLive=4
ReverbHall=4
ReverbBypass=4
DryWetStudio=30
DryWetLive=30
DryWetHall=25
DryWetBypass=30

[FieldLoopback]

[Loopback_LB12]
ChannelName=Loopback 1/2
AudioSource=FX       <- источник
GAIN=0
MUTE=false

[Loopback_LB34] [Loopback_LB56] [Loopback_LB78]

[FieldOutput]

[Output_HP]
ChannelName=HP
AudioSource=Playback 1/2
GAIN=-10
MUTE=0

[Output_OTGOUT]
ChannelName=OTG OUT
AudioSource=Mix A
GAIN=-0.5
MUTE=0

[EQ_IN1]
Switch=0             <- EQ вкл/выкл
GainInput=0
Expanded=0
Eq%401=|0|632|0.7|0  <- ФОРМАТ: |тип|частота|Q|gain|
Eq%402=|0|632|0.7|0
Eq%403=|0|632|0.7|0
Eq%404=|0|632|0.7|0

[EQ_IN2] (то же)

[Compressor]
Switch=true
Threshold=-28
Ratio=4
Attack=7
Release=164
Gain=9
Mix=100
```

---

## 3. РАСШИФРОВКА ПОЛОС EQ

Формат `Eq%40N=|тип|частота|Q|gain|`

Для `|0|632|0.7|0`:
- **тип** = 0
- **частота** = 632 Гц
- **Q** = 0.7
- **gain** = 0 дБ

**Это объясняет HID-блоки `0x91..0x94`!** Там были значения
`0, 1, 0, 632, 7000` — и `632` совпадает с частотой из INI.

Гипотеза (требует проверки): блок `0x9N` =
`PP 1..5 = полосы 1..5 левого канала`, `PP 6..0a = правого`,
а значения в пятёрке — `{тип, Q, ?, частота, ?}`.

---

## 4. ЧТО ЭТО МЕНЯЕТ ДЛЯ БЕКЕНДА

| раньше считали | на самом деле |
|---|---|
| микшер не управляется вообще | **управляется**, но через файл, не HID |
| 48V не найден | **найден**: `[Input_INx] 48V` |
| EQ недоступен | **доступен**: `[EQ_INx]` с полосами |
| loopback не найден | **найден**: `[Loopback_LBxy]` |
| MIC/INST не найден | **найден**: `[Input_INx] MIC` |

**Микшер подтверждён дважды:**
1. Я поставил слайдер Mix A канала IN в UI на 12.
2. В файле появилось `MixA_GAIN=12`.

То есть UI пишет в файл, а не в HID.

---

## 5. КАК ЭТО ИСПОЛЬЗОВАТЬ

Создан модуль `src/workspace.js`:

| функция | назначение |
|---|---|
| `listWorkspaces()` | все workspace-файлы, свежие первыми |
| `findActiveWorkspace()` | самый свежий = активный |
| `readWorkspace(path)` | INI → объект |
| `writeWorkspace(path, obj)` | объект → INI |
| `parseAll(ini)` | всё состояние одним объектом |
| `parseMixer(ini)` | каналы × шины × {gain, solo, mute} |
| `parseEq(ini)` | эквалайзеры с полосами |
| `parseInputs(ini)` | MIC, 48V, SOLO, MUTE, GAIN, Balance |
| `parseLoopback(ini)` | источник, уровень, mute |
| `parseOutputs(ini)` | источник, уровень, mute |
| `parseDucking(ini)` | порог, атака, релиз, карта |
| `parseEffects(ini)` | NC и Reverb |
| `parseCompressor(ini)` | все параметры |

**Проверено на живом файле:** парсер вернул 5 входов (48V=ON у IN1),
10 каналов микшера, 2 EQ по 4 полосы, 4 loopback, 2 выхода.

---

## 6. ОГРАНИЧЕНИЯ (честно)

1. **Файл обновляется MCC, а не устройством.** Если менять настройки
   с передней панели устройства, файл может не обновиться.
2. **Запись в файл ≠ запись в устройство.** Проверено: записал `48V=0`
   в файл — MCC файл не перечитал, значение осталось в файле, а UI
   не изменился. То есть **файл — это приёмник, а не источник**.
3. **Формат недокументирован.** Всё выше — результат наблюдений.
4. **Часть параметров дублируется** в HID (например, громкости), часть
   только в файле (микшер), часть только в HID (метры).

---

## 7. ПРОВЕРЕНО: НАПРАВЛЕНИЕ ЗАПИСИ UI → ФАЙЛ

| действие | файл обновился? | вывод |
|---|---|---|
| слайдер Mix A канала IN → 12 | **ДА**, `MixA_GAIN=12` | работает |
| перетаскивание dial GAIN IN1 | **ДА**, `GAIN` 51 → 43 | работает |
| клик по кнопке 48V | ДА (48V=1) | работает |
| запись в файл вручную | MCC **не применил** | файл не источник |
| Save preset1 | файл не изменился | сохраняет в другом месте |

**Главное:** настройки попадают в файл **после действия в UI**, а не при
сохранении. То есть файл — почти живое зеркало, но обновляется только
по действиям пользователя.

**Запись в файл вручную НЕ применяется** — MCC держит состояние в памяти
и перезаписывает файл своим.

---

## 8. КАК МЕНЯТЬ GAIN ВХОДА (метод с DPI)

Dial'ы (`DialS1M5` GAIN IN1/IN2) **не поддерживают `RangeValuePattern`**,
поэтому значение меняется только перетаскиванием мышью.

**Критично: DPI = 168, масштаб 1.75.**
UIAutomation даёт ЛОГИЧЕСКИЕ координаты, `SetCursorPos` работает в
ФИЗИЧЕСКИХ. Нужно делить на 1.75.

```js
const px = Math.round(logicalX / 1.75);
const py = Math.round(logicalY / 1.75);
// затем: SetCursorPos(px,py) -> mouse_event(DOWN) -> движение по Y -> UP
```

Проверено: `drag dial[283] (164,699) вниз на 40` →
`GAIN` изменился 51 → **43**.

Инструмент: `src/tools/drag-dial.js`.

---

## 9. РЕШАЮЩИЙ ЭКСПЕРИМЕНТ: применяется ли правка файла?

**Дата:** 2026-11-07, раунд 3.

### 9.1 Что делали

1. Записали в **неактивный** файл `ввв.ini` заведомо чужие значения:
   `48V=1`, `GAIN=99`.
2. Переключили workspace в UI MCC с `main` на `ввв`.
3. Смотрели: изменилась ли кнопка 48V в UI, и что стало в файле.

### 9.2 Что получили

| проверка | результат |
|---|---|
| файл после загрузки | `48V=1`, `GAIN=99` — **мои значения сохранены** |
| MCC перезаписал файл своими? | **нет** |
| кнопка 48V в UI | осталась в прежнем состоянии |

**Вывод:** MCC при загрузке workspace **читает файл и не затирает его
своими значениями**. То есть файл для него — источник конфигурации.

**НО:** часть значений он всё же заменил своим (в другом тесте `MixA_GAIN`
вернулось с 7 на 12). Значит не все поля читаются из файла при загрузке —
часть берётся из устройства или из своего кеша.

### 9.3 Практический итог

| способ | применится к устройству? |
|---|---|
| правка активного файла | **нет**, MCC держит состояние в памяти |
| правка файла + переключение workspace | **частично** — файл читается, но не все поля |
| действие в UI | **да**, и файл обновляется |

**Рекомендация для бекенда:** надёжный путь управления — через UI MCC
(UIAutomation), а файл использовать для **чтения** состояния.
Прямая правка файла — ненадёжный путь.

### 9.4 Осторожно: MCC перезаписывает файлы

При работе MCC файлы workspace могут перезаписываться в любой момент.
**Бэкап нужно снимать только при закрытом MCC**, иначе можно сохранить
изменённое состояние. Проверено на себе: бэкап, снятый при работающем
MCC, содержал уже испорченное значение.

Восстановление файлов в `C:\Program Files\...` требует `-Force`
и не всегда срабатывает с первого раза — проверять результат.

---

Dial'ы (`DialS1M5` GAIN IN1/IN2) **не поддерживают `RangeValuePattern`**,
поэтому значение меняется только перетаскиванием мышью.

**Критично: DPI = 168, масштаб 1.75.**
UIAutomation даёт ЛОГИЧЕСКИЕ координаты, `SetCursorPos` работает в
ФИЗИЧЕСКИХ. Нужно делить на 1.75.

```js
const px = Math.round(logicalX / 1.75);
const py = Math.round(logicalY / 1.75);
// затем: SetCursorPos(px,py) -> mouse_event(DOWN) -> движение по Y -> UP
```

Проверено: `drag dial[283] (164,699) вниз на 40` →
`GAIN` изменился 51 → **43**.

Инструмент: `src/tools/drag-dial.js`.
