"""
Проверка: влияют ли ПРАВА ДОСТУПА при открытии handle на DSP-IOCTL.

Гипотеза: драйвер считает устройство «занятым» (биты 18/19),
если handle открыт с GENERIC_WRITE, либо наоборот — DSP требует
особых прав.

Пробуем комбинации:
  - только READ
  - только WRITE
  - READ|WRITE
  - с FILE_FLAG_OVERLAPPED
  - с разными share-режимами

БЕЗОПАСНОСТЬ: только 0x80882200 (чтение) и 0x80882210.
Запись 0x80882204 не вызывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200
IOCTL_VERS = 0x80882210

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
INVALID_HANDLE = ctypes.c_void_p(-1).value

FILE_FLAG_OVERLAPPED = 0x40000000
FILE_ATTRIBUTE_NORMAL = 0x80

OPEN_EXISTING = 3

ACCESS_COMBOS = [
    ("READ", GENERIC_READ, 3, 0),
    ("WRITE", GENERIC_WRITE, 3, 0),
    ("READ|WRITE", GENERIC_READ | GENERIC_WRITE, 3, 0),
    ("READ|WRITE share=0", GENERIC_READ | GENERIC_WRITE, 0, 0),
    ("READ|WRITE overlapped", GENERIC_READ | GENERIC_WRITE, 3, FILE_FLAG_OVERLAPPED),
    ("READ overlapped", GENERIC_READ, 3, FILE_FLAG_OVERLAPPED),
]


class GUID(ctypes.Structure):
    _fields_ = [("d1", wt.DWORD), ("d2", wt.WORD), ("d3", wt.WORD),
                ("d4", ctypes.c_ubyte * 8)]


class DID(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("g", GUID), ("flags", wt.DWORD),
                ("res", ctypes.c_void_p)]


def parse_guid(s):
    s = s.strip("{}")
    p = s.split("-")
    g = GUID()
    g.d1, g.d2, g.d3 = int(p[0], 16), int(p[1], 16), int(p[2], 16)
    for i, b in enumerate(bytes.fromhex(p[3] + p[4])):
        g.d4[i] = b
    return g


sa = ctypes.WinDLL("setupapi", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)

sa.SetupDiGetClassDevsW.restype = ctypes.c_void_p
sa.SetupDiGetClassDevsW.argtypes = [ctypes.POINTER(GUID), wt.LPCWSTR,
                                    ctypes.c_void_p, wt.DWORD]
sa.SetupDiEnumDeviceInterfaces.restype = wt.BOOL
sa.SetupDiEnumDeviceInterfaces.argtypes = [ctypes.c_void_p, ctypes.c_void_p,
                                           ctypes.POINTER(GUID), wt.DWORD,
                                           ctypes.POINTER(DID)]
sa.SetupDiGetDeviceInterfaceDetailW.restype = wt.BOOL
sa.SetupDiGetDeviceInterfaceDetailW.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(DID), ctypes.c_void_p, wt.DWORD,
    ctypes.POINTER(wt.DWORD), ctypes.c_void_p]
k32.CreateFileW.restype = ctypes.c_void_p
k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                            wt.DWORD, wt.DWORD, ctypes.c_void_p]
k32.DeviceIoControl.restype = wt.BOOL
k32.DeviceIoControl.argtypes = [ctypes.c_void_p, wt.DWORD, ctypes.c_void_p,
                                wt.DWORD, ctypes.c_void_p, wt.DWORD,
                                ctypes.POINTER(wt.DWORD), ctypes.c_void_p]
k32.CloseHandle.argtypes = [ctypes.c_void_p]


def iface_path():
    g = parse_guid(IFACE)
    h = sa.SetupDiGetClassDevsW(ctypes.byref(g), None, None, 0x12)
    d = DID()
    d.cb = ctypes.sizeof(d)
    if not sa.SetupDiEnumDeviceInterfaces(h, None, ctypes.byref(g), 0, ctypes.byref(d)):
        return None
    need = wt.DWORD(0)
    sa.SetupDiGetDeviceInterfaceDetailW(h, ctypes.byref(d), None, 0,
                                       ctypes.byref(need), None)
    buf = ctypes.create_string_buffer(need.value)
    struct.pack_into("I", buf, 0, 8)
    if not sa.SetupDiGetDeviceInterfaceDetailW(h, ctypes.byref(d), buf,
                                              need.value, ctypes.byref(need), None):
        return None
    return ctypes.wstring_at(ctypes.addressof(buf) + 4)


def call(h, code, size, fill=0):
    size = max(size, 4)
    b = ctypes.create_string_buffer(size)
    struct.pack_into("<I", b, 0, fill)
    out = ctypes.create_string_buffer(size)
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, b, size, out, size,
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, bytes(out.raw[:size])


def main():
    path = iface_path()
    if not path:
        print("интерфейс не найден")
        return 1
    print(f"путь: {path}\n")

    for label, access, share, flags in ACCESS_COMBOS:
        h = k32.CreateFileW(path, access, share, None, OPEN_EXISTING,
                            flags or FILE_ATTRIBUTE_NORMAL, None)
        if not h or h == INVALID_HANDLE:
            err = ctypes.get_last_error()
            print(f"  {label:<22} открыть не удалось, err={err}")
            continue

        ok, err, out = call(h, IOCTL_GET, 4, 0)
        g = "OK " if ok else f"0x{err:08X}"
        vok, verr, vout = call(h, IOCTL_VERS, 4, 0)
        v = "OK" if vok else f"0x{verr:08X}"
        print(f"  {label:<22} handle={h:#x}  GET={g:<11} VERS={v}")
        k32.CloseHandle(h)

    return 0


if __name__ == "__main__":
    sys.exit(main())
