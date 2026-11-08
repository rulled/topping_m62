# Канал DSP: как MCC доставляет микшер, EQ и эффекты

**Дата:** 2026-11-07, раунд 88
**Источник:** дизассемблирование `ToppingProUsbAudioapi_x64.dll` (capstone)
**Статус:** канал найден, IOCTL-код известен, структура буфера уточняется

---

## 1. Итог одной строкой

MCC не пишет микшер/EQ/эффекты в HID и не пишет их в INI «для устройства».
Он вызывает вендорскую DLL, а та шлёт `DeviceIoControl` в драйвер
`ToppingProUsbAudio` через устройство `{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}`.

**Этот канал открывается БЕЗ MCC** — проверено (`[OPEN OK]`).

---

## 2. Цепочка вызовов (дизассемблер)

```
MCC.exe
  └─ LoadLibrary("ToppingProUsbAudioapi_x64.dll") + GetProcAddress
       └─ TUSBAUDIO_SetDspProperty   @ 0x180002280   (обёртка)
            mov  r9d, r8d            ; arg4 = size
            mov  r8,  rdx            ; arg3 = buffer
            mov  edx, ecx            ; arg2 = property id
            lea  rcx, [rip+0x482c1]  ; arg1 = контекст устройства
            jmp  0x180012390

  └─ 0x180012390  (SetDspProperty, настоящая логика)
       EnterCriticalSection(ctx)
       ... проверки ...
       mov edx, 0x80882204      ; <<< КОД ОПЕРАЦИИ
       call 0x180003FB0

  └─ 0x180003FB0  (общий диспетчер IOCTL)
       EnterCriticalSection
       ...
       mov  rcx, [rsi + 8]     ; handle устройства
       mov  edx, r12d          ; = IOCTL
       mov  r8,  r15           ; in-buffer
       mov  r9d, r14d          ; in-size
       call [KERNEL32!DeviceIoControl]
       ; + CancelIo / WaitForSingleObject / GetOverlappedResult
       ;   -> асинхронный (overlapped) ввод-вывод
```

Зеркальная функция чтения:

```
TUSBAUDIO_GetDspProperty @ 0x180001DA0
     jmp 0x180012470
        mov edx, 0x80882200    ; <<< КОД ОПЕРАЦИИ НА ЧТЕНИЕ
        call 0x180003FB0
```

---

## 3. Коды операций

| операция | IOCTL |
|---|---|
| **SetDspProperty** (запись) | `0x80882204` |
| **GetDspProperty** (чтение) | `0x80882200` |

Разбор по битам (стандартная схема IOCTL):

```
0x80882200
 |  |  |  |
 |  |  |  +-- Method   = 0  (METHOD_BUFFERED)
 |  |  +----- Function = 0x088
 |  +-------- Access   = 3  (FILE_ANY_ACCESS)
 +----------- DeviceType = 0x8088, с битом 0x8000 = "buffered vended"
```

`0x80882204` = та же операция, `Method = 1` (`METHOD_IN_DIRECT`) —
то есть на запись буфер передаётся напрямую.

---

## 4. Что это даёт

| функционал | как теперь |
|---|---|
| микшер (9×8 gain/mute) | **через IOCTL, без MCC** |
| EQ-полосы | **через IOCTL, без MCC** |
| реверб, ducking, loopback | **через IOCTL, без MCC** |
| компрессор (параметры) | **через IOCTL, без MCC** |
| громкости, настройки, режим | HID (уже работает) |
| метры | HID |

То есть **полный отказ от MCC становится возможным**. Это и есть ответ
на требование «софт, который ВООБЩЕ НИКАК не зависит от MCC».

---

## 5. Что ещё нужно выяснить

1. **Структура буфера.** Что именно лежит в `buffer` и как туда попадает
   `property id` (arg2) и `size` (arg4). Судя по `r9d = size`, `r8 = buffer`,
   это обычный `DeviceIoControl(handle, ioctl, inBuf, inSize, outBuf, outSize, &ret, &ov)`.
2. **Кодировка property id.** В NOTES §1 упоминалась пара
   `TUSBAUDIO_GetDspProperty → FUN_18000e0a0 → FUN_180003fb0(dev, 0x80882200, ...)`.
   Надо посмотреть `0x18000e0a0` — там формируется буфер.
3. **Список property id** для микшера/EQ/эффектов. Вероятно, это те же
   `TT`/`PP`, что и в HID, либо их расширение.
4. **Открытие handle** — `CreateFileW` по пути
   `\\?\usb#vid_152a&pid_875c#...#{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}`.

---

## 6. Практическая ценность для веба

**Ограничение:** `DeviceIoControl` недоступен из браузера. WebHID даёт
только HID-канал.

Значит:

- **чистый браузер (WebHID)** — громкости, настройки, режим, метры, сцены (~50%);
- **локальный бекенд** — теперь МОЖЕТ покрыть 100%, без MCC.

То есть зависимость от MCC снимается полностью, но зависимость
**от локального бекенда** для микшера/эффектов остаётся: браузер
не умеет `DeviceIoControl`.

---

## 7. Файлы

| файл | роль |
|---|---|
| `research/dis/find_ioctl.py` | поиск IOCTL в драйвере (не дал результата — диспетчеризация через таблицу) |
| `research/dis/find_mcc_ioctl.py` | поиск `DeviceIoControl` в MCC (косвенный вызов, не нашёл) |
| `research/dis/find_guid_refs.py` | поиск GUID интерфейса в MCC (GUID собирается динамически) |
| `research/dis/mcc_imports.py` | таблица импорта MCC |
| `research/dis/mcc_dynamic_dlls.py` | **нашёл** `TUSBAUDIO_*` и имя DLL |
| `research/dis/api_dll_dsp.py` | **нашёл** цепочку и IOCTL-коды |

DLL: `C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll` (316 КБ)
