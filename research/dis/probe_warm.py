"""
Проверка валидности handle и попытка «прогреть» контекст.

Проблема: OpenDeviceByIndex(0) вернул успех (handle=0x10000), но
GetDeviceCount вернул ошибку и count=0, а GetDspProperty на любой
propId отвечает 0xEE000048 (неверный параметр) — таблица свойств пуста.

Гипотеза: контекст надо инициализировать вызовом чего-то ещё
(GetDeviceProperties / RegisterDeviceNotification), либо
GetDeviceCount имеет другую сигнатуру.

БЕЗОПАСНОСТЬ: только чтение и перечисление. SetDspProperty НЕ вызывается.

Запуск: python research/dis/probe_warm.py
"""

import ctypes
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"


def u32(v):
    return v & 0xFFFFFFFF


def show(name, rc, extra=""):
    rc = u32(rc)
    tag = "OK " if rc == 0 else f"0x{rc:08X}"
    print(f"  {name:<42} {tag} {extra}".rstrip())


def main():
    dll = ctypes.WinDLL(DLL_PATH)

    # --- варианты сигнатуры GetDeviceCount ---
    print("=== GetDeviceCount: пробуем разные сигнатуры ===")
    cnt = ctypes.c_uint32(0)

    # (a) как сделали раньше
    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    show("GetDeviceCount(&count) uint32*", rc, f"count={cnt.value}")

    # (b) через 64-битный out
    cnt64 = ctypes.c_uint64(0)
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint64)]
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt64))
    show("GetDeviceCount(&count) uint64*", rc, f"count={cnt64.value}")

    # (c) без аргументов (может вернуть число)
    dll.TUSBAUDIO_GetDeviceCount.argtypes = []
    rc = dll.TUSBAUDIO_GetDeviceCount()
    show("GetDeviceCount() как возврат", rc, f"-> {u32(rc)}")

    # --- enumerate ещё раз ---
    print("\n=== EnumerateDevices ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    show("EnumerateDevices()", rc)

    # --- открытие ---
    print("\n=== OpenDeviceByIndex ===")
    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    show("OpenDeviceByIndex(0, &h)", rc, f"handle=0x{handle.value or 0:X}")
    if u32(rc) != 0:
        return 1

    # --- проверяем, что handle живой: InstanceId / DeviceProperties ---
    print("\n=== проверка handle ===")
    try:
        dll.TUSBAUDIO_GetDeviceInstanceIdString.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetDeviceInstanceIdString.argtypes = [
            ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32,
        ]
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDeviceInstanceIdString(handle, buf, 256)
        show("GetDeviceInstanceIdString(h, buf, 256)", rc, f"-> {buf.value!r}")
    except AttributeError as exc:
        print(f"  нет: {exc}")

    try:
        dll.TUSBAUDIO_GetCustomString.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetCustomString.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
        ]
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetCustomString(handle, 0, buf, 256)
        show("GetCustomString(h, 0, buf, 256)", rc, f"-> {buf.value!r}")
    except AttributeError as exc:
        print(f"  нет: {exc}")

    try:
        dll.TUSBAUDIO_GetCurrentSampleRate.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetCurrentSampleRate.argtypes = [
            ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32),
        ]
        sr = ctypes.c_uint32(0)
        rc = dll.TUSBAUDIO_GetCurrentSampleRate(handle, ctypes.byref(sr))
        show("GetCurrentSampleRate(h, &sr)", rc, f"sr={sr.value}")
    except AttributeError as exc:
        print(f"  нет: {exc}")

    # --- и только теперь DSP ---
    print("\n=== GetDspProperty после «прогрева» ===")
    dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDspProperty.argtypes = [
        ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
    ]
    for prop in (0, 1, 2, 3, 4, 5, 0x10):
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDspProperty(prop, buf, 256)
        if u32(rc) == 0:
            print(f"  prop={prop} OK -> {buf.raw[:16].hex()}")
        else:
            print(f"  prop={prop} 0x{u32(rc):08X}")

    dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
    dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
    rc = dll.TUSBAUDIO_CloseDevice(handle)
    show("\nCloseDevice", rc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
