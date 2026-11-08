"""
Полный список экспортов вендорской DLL + правильный порядок инициализации.

Вопрос: как открыть устройство? В DLL нет TUSBAUDIO_OpenDevice —
значит открытие называется иначе (возможно, OpenDeviceByIndex /
OpenDeviceByInstanceId / CreateDevice).

Только чтение/перечисление, без записи в устройство.
"""

import ctypes
import re
import sys

import pefile

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"


def u32(v):
    return v & 0xFFFFFFFF


def main():
    # --- все экспорты ---
    pe = pefile.PE(DLL_PATH, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]]
    )
    names = []
    for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
        if exp.name:
            names.append(exp.name.decode("ascii", "replace"))
    print(f"всего экспортов: {len(names)}")

    print("\n=== всё, что связано с открытием/устройством ===")
    for n in sorted(names):
        if re.search(r"Open|Close|Device|Enumerate|Create|Attach", n, re.I):
            print(f"  {n}")

    # --- порядок: Enumerate -> Count ---
    print("\n=== порядок инициализации ===")
    dll = ctypes.WinDLL(DLL_PATH)

    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  EnumerateDevices() -> 0x{u32(rc):08X}")

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  GetDeviceCount()   -> 0x{u32(rc):08X}, count={cnt.value}")

    if cnt.value == 0:
        print("\n  устройств не найдено — возможно, нужен MCC или другой порядок")
        # попробуем ещё раз после паузы
        import time
        for i in range(3):
            time.sleep(1.0)
            rc = dll.TUSBAUDIO_EnumerateDevices()
            rc2 = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
            print(f"  повтор {i + 1}: enum=0x{u32(rc):08X} count={cnt.value}")
            if cnt.value:
                break

    # --- если нашли, попробуем открыть ---
    if cnt.value > 0:
        print("\n=== пробуем открыть ===")
        for cand in (
            "TUSBAUDIO_OpenDeviceByIndex",
            "TUSBAUDIO_OpenDeviceByInstanceId",
            "TUSBAUDIO_CreateDevice",
            "TUSBAUDIO_OpenDevice",
        ):
            if cand in names:
                print(f"  есть: {cand}")
            else:
                print(f"  нет:  {cand}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
