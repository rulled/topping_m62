"""
Проверка: доступны ли IOCTL, требующие [dev+0x4c4] == 1,
и можно ли вообще получить DSP-данные.

Из дизассемблера требование `cmp dword [r15+0x4c4], 1` есть у:
    0x80882100 (handler 0x140026D33, esi==0x84, r13d==8)
    0x80882200 (GetDspProperty)
    0x80882204 (SetDspProperty)

Если 0x80882200 даёт 0xEE000030 (а не 0xEE000053), значит проверка
0x4c4 ПРОЙДЕНА и дело в бите занятости.

Здесь: проверяем 0x80882100 (не требует inSize==outSize, размер 0x84/8)
и другие IOCTL, чтобы понять состояние устройства.

БЕЗОПАСНОСТЬ: только «получающие» IOCTL. Запись 0x80882204 не вызывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
INVALID_HANDLE = ctypes.c_void_p(-1).value

# IOCTL, которые стоит попробовать (все — «получающие»)
CANDIDATES = [
    (0x80882004, 0x18, 0x18),
    (0x80882086, 0x18, 0x18),
    (0x80882100, 0x84, 0x84),
    (0x8088210C, 8, 8),
    (0x80882110, 4, 4),
    (0x80882144, 4, 4),
    (0x80882148, 8, 8),
    (0x80882180, 4, 4),
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


def open_dev():
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
    path = ctypes.wstring_at(ctypes.addressof(buf) + 4)
    return k32.CreateFileW(path, GENERIC_READ | GENERIC_WRITE, 3, None, 3, 0, None)


ERROR_HINTS = {
    0xEE000030: "занято / операция идёт",
    0xEE000041: "нулевой аргумент",
    0xEE000043: "inSize != outSize",
    0xEE000045: "неверный размер",
    0xEE000048: "неверный параметр",
    0xEE000049: "неверное состояние",
    0xEE000053: "устройство не в состоянии 1 ([+0x4c4])",
    0xEE000070: "нет списка устройств",
    0xEE001002: "не инициализировано",
}


def hint(err):
    return ERROR_HINTS.get(err, "")


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle={h:#x}\n")

    for code, insize, outsize in CANDIDATES:
        b = ctypes.create_string_buffer(insize)
        out = ctypes.create_string_buffer(outsize)
        ret = wt.DWORD(0)
        ok = k32.DeviceIoControl(h, code, b, insize, out, outsize,
                                 ctypes.byref(ret), None)
        err = ctypes.get_last_error() & 0xFFFFFFFF
        if ok:
            print(f"  0x{code:08X}  OK   ret={ret.value:<4} out={bytes(out.raw[:16]).hex()}")
        else:
            print(f"  0x{code:08X}  0x{err:08X}  {hint(err)}")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
