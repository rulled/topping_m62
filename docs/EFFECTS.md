# M62 — шумоподавление (NC), компрессор, реверб

> Расшифровано 2026-11-08 в Mobile-режиме.
> Разбор: `src/tools/map-nc-tags.js`, `map-nc-level.js`.

---

## Что нашлось в MCC

Реверс строк `M Control Center.exe` показал **четыре DSP-блока**,
которых нет в workspace-INI (кроме одного):

```
Compressor_IN1 / Compressor_IN2    ← а мы видели только один Compressor
Expander_IN1 / Expander_IN2        ← нет в INI вообще
Denoise_IN1 / Denoise_IN2          ← нет в INI вообще
Ducking
```

В UI это панели с AutomationId:

```
Effect_NC          шумоподавление
Effect_Compressor  компрессор
Effect_Reverb      реверб
```

**Важно:** в Mobile они все три видны одновременно (`FieldEffect`).
В Live — тоже. В Prof эффектов нет.

---

## Семейство 0x44 — не только NC

> **Уточнено 2026-11-09.** Прежний заголовок этого раздела был
> «Семейство 0x44 — это NC, а не «реверб»». Формулировка вводит
> в заблуждение: `0x44` несёт **несколько разных блоков**, а не один.
> На этой странице описан только тот, что удалось расшифровать (NC).

Что достоверно лежит в `0x44`:

| диапазон | что | чем подтверждено |
|---|---|---|
| `0x44:0x01..0x05` | уровни FX-входов: IN1, IN2, AUX, BT, OTG | движение слайдеров FX |
| `0x44:0x0d/0x0e` | **метры FX in/out** | есть только в Live; на них держится определение режима в `src/modes.js` |
| `0x44:0x06/07/09` | шумоподавление (NC) | таблица ниже |
| `0x44:0x08/0a/0b/0c/0f` | **реверб** | см. раздел ниже, подтверждено записью |

### Реверб — найден 2026-11-10

Карта взята из дизассемблера MCC (`FUN_140230b20`, NOTES §11.5) и
подтверждена записью на живом устройстве:

| тег | параметр | проверено |
|---|---|---|
| `0x44:0x08` | DryWet | запись 25 → 40, принято |
| `0x44:0x09` | Room | запись 4 → 6, принято |
| `0x44:0x0a` | Decay | запись 11 → 14, принято |
| `0x44:0x0b` | ReverbType | Bypass=1, STUDIO=2, LIVE=3, HALL=4 |
| `0x44:0x0c` | MuteFX | 0/1 |
| `0x44:0x0f` | Width | `int(x * 100)`, 0.7 → 70 |

**Ловушка:** при `ReverbType = Bypass` параметры DryWet/Room/Decay/Width
**не применяются** — устройство молча игнорирует запись. Это же верно
для дилов в самом MCC (NOTES §71).

Код: [`src/reverb-hid.js`](../src/reverb-hid.js).

### Расшифрованные теги NC

| тег | что | проверено |
|---|---|---|
| `0x44:0x06` | **уровень шумоподавления** | 35 → 40 → 35 через дил |
| `0x44:0x07` | тип NC / bypass | NC1=15, NC2=30, bypass=0 |
| `0x44:0x08` | ? | всегда 0 |
| `0x44:0x09` | тип NC, код | NC1 = 1 |
| `0x44:0x0a` | ? | всегда 0 |
| `0x44:0x0b` | ? | 1 |
| `0x44:0x0f` | ? | 0 |

### Как проверялось

```
1. Снимок 0x44
2. Переключить pushButtonNC2 в UI
3. Снимок заново

  44:07: 15 -> 30   (NC1=15, NC2=30 — ровно значения из Effect_NC)

4. Нажать pushButtonBypassNoise
  44:07: 15 -> 0    (bypass выключает)

5. Фокус на dialNoiseReduction + 5 стрелок вверх
  44:06: 35 -> 40   (уровень NC)
```

Все значения вернулись обратно.

---

## Ловушка: у дилов эффектов нет RangeValuePattern

У `DialS1M5` в панели NC **нет** `RangeValuePattern`. Есть только:

```
Value       есть, но пустой ("")
Invoke      есть
RangeValue  НЕТ
```

Поэтому стандартный путь «прочитать RangeValue у дила» даёт `null`.
Так же у `DialS1M1` компрессора и реверба.

**Значение читается из соседнего `QLineEdit`:**

```
Effect_NC.lineEditNoiseReduction
```

Но и там текст, а не число — `"Noise Reduction"`. То есть числовое
значение в UI не отображается вообще, только на самом диле визуально.

**Практический вывод:** параметры эффектов надо брать из HID-тегов
(`0x44`, `0x46`), а не из UI. UI годится только для **изменения**
(фокус + стрелки), чтобы понять, какой тег за что отвечает.

---

## AutomationId — это ПОЛНЫЙ ПУТЬ, а не короткое имя

Важная деталь для всех будущих скриптов:

```
QApplication.MainWindow_M62.centralWidget.stackedWidget.PageMble.
  PageMbleFrameBody.PageMbleFrameEO.PageMbleSplitterE_O.FieldEffect.
  QScrollArea.qt_scrollarea_viewport.QWidget.Effect_NC.dialNoiseReduction
```

Длина 202 символа. Искать надо **по окончанию**:

```powershell
if (-not ([string]$e.Current.AutomationId).EndsWith("dialNoiseReduction")) { continue }
```

**НЕ работает:** `-notlike "*.dialNoiseReduction"` (точка в шаблоне).
**Работает:** `.EndsWith(...)`.

Это стоило часа отладки — записываю, чтобы не повторять.

---

## Полная карта панели эффектов (Mobile)

```
Effect_NC
  labelNoiseClass            подпись
  ncWidget
    pushButtonNC1            тип NC1 (классический)
    pushButtonNC2            тип NC2 (агрессивный)
  lineEditNoiseReduction     текст "Noise Reduction" (не число!)
  dialNoiseReduction         уровень, без RangeValue
  ncBypassWidget
    pushButtonBypassNoise    обход (TogglePattern)

Effect_Compressor
  compressWidget
    compressBypass           обход (TogglePattern, было On)
  lineEditCompress           текст
  labelThreshold / Small / Large
  dialGain                   gain, без RangeValue
  dialThreshold              порог, без RangeValue
  widgetCompress             Chart — кривая
  labelGainMin / labelGain / labelGainMax
  buttonMore                 расширенный режим

Effect_Reverb
  labelWet / labelDry
  dialDryWet                 dry/wet
  rbWidget
    pushButtonReverbStudio / Live / Hall
    pushButtonBypassReverb   обход (TogglePattern, было On)
  lineEditReverb             текст
  labelRoomSize / dialRoom
  dialWidth / labelWidth
  labelDecayRate / dialDecay
```

---

## Различие режимов по эффектам

| режим | NC | Reverb | Compressor | Expander | EQ наушников |
|---|---|---|---|---|---|
| Mobile | есть | есть | есть | ? | нет |
| Live | есть (в `Effect_Integration`) | есть | есть | ? | нет |
| Prof | нет | нет | есть | ? | **есть, 6 полос** |

В workspace-INI:

```
Mobile:  [Effect_NC], [Effect_Reverb]        — отдельные секции
Live:    [Effect_Integration]                — NC + Reverb вместе
Prof:    [EQ_HP]                             — EQ наушников, 6 полос
```

---

## Что осталось

- **Expander** (`Expander_IN1/IN2`) — есть в строках exe, но в UI
  не найден. Возможно, появляется при другом режиме или скрыт за
  `buttonMore`.
- **`0xa1..0xaa`** — не появились ни в Live, ни в Mobile. Возможно,
  это Expander или второй набор EQ.
- **`0x44:08/0x0a/0x0b/0x0f`** — смысл не установлен.
- **Числовые значения** эффектов в UI не отображаются, поэтому
  читать их можно только из HID-тегов.
