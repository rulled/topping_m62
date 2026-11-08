"""
Проверка: нужна ли COM-инициализация для работы вендорской DLL.

DLL импортирует ole32.dll — вероятно, использует COM для перечисления
аудиоустройств (MMDevice API) или для device notification.

Гипотеза: без CoInitialize/CoCreateInstance список устройств пуст.

БЕЗОПАСНОСТЬ: только чтение/перечисление.
"""

import ctypes
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

ole32 = ctypes.WinDLL("ole32")
kernel32 = ctypes.WinDLL("kernel32")


def u32(v):
    return v & 0xFFFFFFFF


def try_with_com(com_mode):
    """com_mode: None | 'STA' | 'MTA'"""
    # сбрасываем DLL между попытками нельзя (уже загружена),
    # поэтому один режим за процесс
    if com_mode == "STA":
        hr = ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
    elif com_mode == "MTA":
        hr = ole32.CoInitializeEx(None, 0x0)  # COINIT_MULTITHREADED
    else:
        hr = None

    dll = ctypes.WinDLL(DLL_PATH)

    # API version
    dll.TUSBAUDIO_GetApiVersion.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetApiVersion.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    ver = ctypes.c_uint32(0)
    rc_v = dll.TUSBAUDIO_GetApiVersion(ctypes.byref(ver))

    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc_e = dll.TUSBAUDIO_EnumerateDevices()

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc_c = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))

    print(f"  COM={com_mode or 'нет':<4} CoInit=0x{u32(hr) if hr is not None else 0:08X} "
          f"ver=0x{u32(rc_v):08X}:0x{ver.value:X} "
          f"enum=0x{u32(rc_e):08X} count=0x{u32(rc_c):08X}:{cnt.value}")

    return cnt.value


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else None
    print(f"=== режим COM: {mode} ===")
    n = try_with_com(mode)
    if n:
        print(f"\nУСТРОЙСТВ НАЙДЕНО: {n}")
        return 0
    print("\n0 устройств")
    return 1


if __name__ == "__main__":
    sys.exit(main())
