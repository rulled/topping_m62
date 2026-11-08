"""
Решающий тест: загрузка DLL с ПРАВИЛЬНЫМ рабочим каталогом.

Наблюдение: при загрузке DLL читает custom.ini через GetModuleFileNameW,
но затем может искать файлы относительно ТЕКУЩЕГО каталога.

Гипотеза: список устройств пуст, потому что DLL не нашла custom.ini
или не смогла инициализировать перечисление из-за рабочего каталога.

Тест: меняем рабочий каталог на папку DLL и повторяем.
БЕЗОПАСНОСТЬ: только чтение/перечисление, никакой записи.
"""

import ctypes
import os
import sys

DLL_DIR = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64"
DLL_PATH = os.path.join(DLL_DIR, "ToppingProUsbAudioapi_x64.dll")


def u32(v):
    return v & 0xFFFFFFFF


def probe(label):
    dll = ctypes.WinDLL(DLL_PATH)

    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc2 = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))

    print(f"  {label}")
    print(f"    EnumerateDevices -> 0x{u32(rc):08X}")
    print(f"    GetDeviceCount   -> 0x{u32(rc2):08X}, count={cnt.value}")

    if cnt.value == 0:
        return None

    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [
        ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)
    ]
    h = ctypes.c_void_p(0)
    rc3 = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(h))
    print(f"    OpenDeviceByIndex -> 0x{u32(rc3):08X}, handle=0x{h.value or 0:X}")

    if u32(rc3) != 0:
        return None

    # читаем DSP
    dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDspProperty.argtypes = [
        ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
    ]
    print("    --- DSP ---")
    got = 0
    for prop in range(0, 16):
        buf = ctypes.create_string_buffer(256)
        rc4 = dll.TUSBAUDIO_GetDspProperty(prop, buf, 256)
        if u32(rc4) == 0:
            print(f"      prop={prop:>2} OK  {buf.raw[:16].hex()}")
            got += 1
        else:
            print(f"      prop={prop:>2} 0x{u32(rc4):08X}")
    print(f"    прочитано: {got}")

    dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
    dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
    dll.TUSBAUDIO_CloseDevice(h)
    return h


def main():
    print("=== до смены каталога ===")
    print(f"  cwd = {os.getcwd()}")
    probe("cwd=по умолчанию")

    print("\n=== после смены каталога на папку DLL ===")
    try:
        os.chdir(DLL_DIR)
        print(f"  cwd = {os.getcwd()}")
        probe("cwd=папка DLL")
    except OSError as exc:
        print(f"  не удалось: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
