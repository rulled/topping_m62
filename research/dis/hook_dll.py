"""
Перехват вызовов вендорской DLL через IAT-патчинг в собственном процессе.

ИДЕЯ: загружаем ToppingProUsbAudioapi_x64.dll в свой процесс, подменяем
ей импорты (DeviceIoControl, CreateFileW, SetupDiGetClassDevsW,
SetupDiEnumDeviceInterfaces) на свои функции-обёртки, которые пишут
аргументы в лог и вызывают оригинал.

Так мы увидим:
  - по какому пути она открывает устройство;
  - какие IOCTL шлёт и с какими буферами;
  - какой GUID передаёт в SetupDiGetClassDevs.

Это НЕ модифицирует ни DLL, ни драйвер — только таблицу импорта
в памяти нашего процесса.

Запуск: python research/dis/hook_dll.py
"""

import ctypes
import ctypes.wintypes as wt
import json
import struct
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

LOG = []

# ---------------------------------------------------------------------------
# Прототипы
# ---------------------------------------------------------------------------
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
setupapi = ctypes.WinDLL("setupapi", use_last_error=True)

DEVICE_IO_CONTROL = kernel32.DeviceIoControl
CREATE_FILE_W = kernel32.CreateFileW
SETUP_DI_GET_CLASS_DEVS_W = setupapi.SetupDiGetClassDevsW
SETUP_DI_ENUM_INTERFACES = setupapi.SetupDiEnumDeviceInterfaces

# типы для обёрток
LPOVERLAPPED = ctypes.c_void_p

DeviceIoControlProto = ctypes.WINFUNCTYPE(
    wt.BOOL, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p, wt.DWORD, ctypes.c_void_p, wt.DWORD,
    ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
)
CreateFileWProto = ctypes.WINFUNCTYPE(
    ctypes.c_void_p, wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
    wt.DWORD, wt.DWORD, ctypes.c_void_p,
)


def hexdump(data, limit=64):
    if not data:
        return ""
    b = bytes(data[:limit])
    return b.hex()


# ---------------------------------------------------------------------------
# Обёртки
# ---------------------------------------------------------------------------
@DeviceIoControlProto
def hook_DeviceIoControl(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov):
    entry = {
        "call": "DeviceIoControl",
        "handle": f"0x{h:X}" if h else None,
        "ioctl": f"0x{ioctl:08X}",
        "inSize": insize,
        "inBuf": hexdump(ctypes.string_at(inbuf, insize))
        if inbuf and insize and insize <= 4096 else None,
        "outSize": outsize,
    }
    ok = DEVICE_IO_CONTROL(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov)
    err = ctypes.get_last_error()
    entry["ok"] = bool(ok)
    entry["err"] = err
    if ok and outbuf and ret:
        n = ret[0] if isinstance(ret, tuple) else ret._obj.value
        if n:
            entry["outBuf"] = hexdump(ctypes.string_at(outbuf, min(n, 256)))
    LOG.append(entry)
    return ok


@CreateFileWProto
def hook_CreateFileW(path, access, share, sa, disp, flags, tmpl):
    LOG.append({
        "call": "CreateFileW",
        "path": path,
        "access": f"0x{access:08X}",
        "share": share,
        "disp": disp,
    })
    return CREATE_FILE_W(path, access, share, sa, disp, flags, tmpl)


def main():
    print("=== загружаем DLL ===")
    try:
        dll = ctypes.WinDLL(DLL_PATH)
    except OSError as exc:
        print(f"  FAILED: {exc}")
        return 1
    print(f"  OK, база 0x{dll._handle:X}")

    print("\n=== инициализация ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  EnumerateDevices -> 0x{rc & 0xFFFFFFFF:08X}")

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  GetDeviceCount -> 0x{rc & 0xFFFFFFFF:08X}, count={cnt.value}")

    # --- открытие ---
    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [
        ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)
    ]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    print(f"  OpenDeviceByIndex -> 0x{rc & 0xFFFFFFFF:08X}, handle=0x{handle.value or 0:X}")

    print("\n=== лог вызовов (без хука — IAT патчить не стали) ===")
    print(json.dumps(LOG, indent=2, ensure_ascii=False)[:4000])
    print(f"\nвсего событий: {len(LOG)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
