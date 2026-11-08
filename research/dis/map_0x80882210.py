"""
Карта рабочего IOCTL 0x80882210.

Уже известно:
    in=0 -> 16 (0x10)
    in=1 -> 10 (0x0A)
    in=2 -> 0

Похоже на «версия API» (major=16, minor=10) либо таблицу свойств.
Перебираем широкий диапазон и записываем ответы.

БЕЗОПАСНОСТЬ: 0x80882210 — ЧТЕНИЕ (не SetDspProperty 0x80882204).
0x80882204 не вызывается ни при каких условиях.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL = 0x80882210

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
INVALID_HANDLE = ctypes.c_void_p(-1).value


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


def read4(h, value):
    b = struct.pack("<I", value)
    out = ctypes.create_string_buffer(4)
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, IOCTL, b, 4, out, 4, ctypes.byref(ret), None)
    if not ok:
        return None, ctypes.get_last_error() & 0xFFFFFFFF
    return struct.unpack("<I", out.raw[:4])[0], 0


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle=0x{h:X}\n")

    print("=== 0x80882210: in -> out ===")
    nonzero = []
    for v in range(0, 64):
        val, err = read4(h, v)
        if val is None:
            print(f"  in={v:>3} err=0x{err:08X}")
        else:
            mark = "  <-- НЕ НУЛЬ" if val != 0 else ""
            print(f"  in={v:>3} out={val:>6}  (0x{val:04X}){mark}")
            if val != 0:
                nonzero.append((v, val))

    print(f"\nненулевых: {len(nonzero)}")
    print("\n=== сводка ===")
    for v, val in nonzero:
        print(f"  in={v} -> {val} (0x{val:X})")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
