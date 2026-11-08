"""
Попытка открыть устройство через вендорскую DLL и прочитать DSP-свойство.

Сигнатуры из дизассемблера:
  TUSBAUDIO_EnumerateDevices()                  -> code
  TUSBAUDIO_GetDeviceCount(uint32 *count)       -> code
  TUSBAUDIO_OpenDeviceByIndex(uint32 idx, void **handle) -> code
  TUSBAUDIO_GetDspProperty(handle, uint32 id, void *buf, uint32 size) -> code
  TUSBAUDIO_CloseDevice(handle)                 -> code

БЕЗОПАСНОСТЬ: только Open + GetDspProperty (чтение) + Close.
SetDspProperty НЕ вызывается.

Запуск: python research/dis/probe_open_device.py
"""

import ctypes
import sys
import time

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

ERROR_HINTS = {
    0xEE000032: "неверное состояние / операция не завершена",
    0xEE000033: "устройство не открыто",
    0xEE000041: "нулевой аргумент",
    0xEE000048: "неверный параметр",
    0x00000001: "общий сбой",
}


def u32(v):
    return v & 0xFFFFFFFF


def explain(rc):
    rc = u32(rc)
    if rc == 0:
        return "OK"
    hint = ERROR_HINTS.get(rc, "")
    return f"0x{rc:08X}" + (f" — {hint}" if hint else "")


def main():
    dll = ctypes.WinDLL(DLL_PATH)
    print("DLL загружена\n")

    # --- API version ---
    dll.TUSBAUDIO_GetApiVersion.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetApiVersion.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    ver = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetApiVersion(ctypes.byref(ver))
    print(f"GetApiVersion -> {explain(rc)}, version=0x{ver.value:X}")

    # --- enumerate ---
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"EnumerateDevices() -> {explain(rc)}")

    # --- count ---
    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"GetDeviceCount -> {explain(rc)}, count={cnt.value}")

    # --- пробуем открыть по индексу 0 ---
    print("\n=== OpenDeviceByIndex(0) ===")
    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    print(f"  -> {explain(rc)}, handle=0x{handle.value or 0:X}")

    if u32(rc) != 0 or not handle.value:
        print("\n  устройство не открылось.")
        print("  ВОЗМОЖНАЯ ПРИЧИНА: DLL кэширует список и нуждается в"
              " уведомлении от драйвера, либо индекс другой.")
        # попробуем 1..3
        for idx in (1, 2, 3):
            h2 = ctypes.c_void_p(0)
            rc2 = dll.TUSBAUDIO_OpenDeviceByIndex(idx, ctypes.byref(h2))
            print(f"  индекс {idx}: {explain(rc2)} handle=0x{h2.value or 0:X}")
            if u32(rc2) == 0 and h2.value:
                handle = h2
                rc = rc2
                break

    if u32(rc) != 0 or not handle.value:
        print("\nитог: открыть не удалось, DSP не читаем этим путём")
        return 1

    # --- читаем DSP-свойства ---
    print(f"\n=== GetDspProperty (handle=0x{handle.value:X}) ===")
    dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDspProperty.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
    ]
    # значения, которые уже наблюдались у MCC как property id
    for prop in (0, 1, 2, 3, 0x10, 0x11, 0x100):
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDspProperty(handle, prop, buf, 256)
        if u32(rc) == 0:
            print(f"  prop=0x{prop:X} OK  {buf.raw[:16].hex()}")
        else:
            print(f"  prop=0x{prop:X} {explain(rc)}")

    # --- закрываем ---
    dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
    dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
    rc = dll.TUSBAUDIO_CloseDevice(handle)
    print(f"\nCloseDevice -> {explain(rc)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
