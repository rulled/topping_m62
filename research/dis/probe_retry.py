"""
ПРАВИЛЬНАЯ сигнатура OpenDeviceByIndex — три аргумента.

Из дизассемблера 0x180010EB0:
    mov r14, r8        ; arg3 = out handle
    mov ebp, edx       ; arg2 = index
    mov rsi, rcx       ; arg1 = ВНУТРЕННИЙ КОНТЕКСТ (не наружу!)
    ...
    cmp qword ptr [rsi + 0x30], 0     ; контекст должен быть инициализирован
    mov rax, [rsi+0x50] - [rsi+0x48]  ; /4 = число устройств
    cmp ebp, eax                      ; index < count ?
    ...
    call 0x180010AE0                  ; собственно открытие
    mov [r14], rbx                    ; out handle

То есть экспортируемая обёртка 0x1800020E0 делает:
    mov r8, rdx        ; out -> arg3
    mov edx, ecx       ; index -> arg2
    lea rcx, [rip+..]  ; контекст -> arg1
    jmp 0x180010EB0

=> Наружная сигнатура: OpenDeviceByIndex(uint32 index, void **handle)
   (контекст подставляет сама обёртка) — как я и вызывал.

Но handle=0x10000 при count=0 означает, что ВНУТРЕННИЙ список пуст,
и проверка index<count дала... на самом деле 0xEE000047 при пустом списке.
А мы получили OK — значит ветка другая, и "handle" на самом деле
мог быть записан только при успехе.

ВАЖНО: GetDeviceCount возвращает 0 -> список устройств ПУСТ.
Причина: драйвер не отдаёт устройства этой DLL, пока их не «увидит».

Проверяем: работает ли всё это при ЗАПУЩЕННОМ MCC (он прогревает DLL),
и смотрим, что отдаёт GetDeviceCount тогда.

БЕЗОПАСНОСТЬ: только чтение.
"""

import ctypes
import sys
import time

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"


def u32(v):
    return v & 0xFFFFFFFF


def main():
    dll = ctypes.WinDLL(DLL_PATH)

    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]

    for attempt in range(5):
        rc = dll.TUSBAUDIO_EnumerateDevices()
        cnt = ctypes.c_uint32(0)
        rc2 = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
        print(f"попытка {attempt + 1}: enum=0x{u32(rc):08X} count_rc=0x{u32(rc2):08X} count={cnt.value}")
        if cnt.value:
            break
        time.sleep(1.0)

    if cnt.value == 0:
        print("\nСПИСОК УСТРОЙСТВ ПУСТ даже после 5 попыток.")
        print("Значит DLL находит устройства только когда их видит драйвер,")
        print("а признак этого — уведомление, которое приходит при старте MCC")
        print("или при подключении устройства.")
        return 1

    # --- открываем ---
    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    print(f"\nOpenDeviceByIndex(0) -> 0x{u32(rc):08X} handle=0x{handle.value or 0:X}")
    if u32(rc) != 0:
        return 1

    # --- DSP ---
    dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDspProperty.argtypes = [ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    print("\n=== DSP ===")
    got = 0
    for prop in range(0, 32):
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDspProperty(prop, buf, 256)
        if u32(rc) == 0:
            print(f"  prop={prop} OK {buf.raw[:16].hex()}")
            got += 1
    print(f"прочитано: {got}")

    dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
    dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
    dll.TUSBAUDIO_CloseDevice(handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
