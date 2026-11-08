"""
Проверка обработчика 0x80882210 (0x14002771F).

Из дизассемблера:
    0x14002771F: cmp  r13d, 4        ; outSize == 4 ?
    0x140027723: jne  <err>
    0x140027729: cmp  esi, r13d      ; inSize == outSize ?
    0x14002772C: jne  <err>

Значит 0x80882210 хочет РОВНО 4 байта в обе стороны.

А 0x80882200 (0x140027594) требует:
    0x1400275A2: cmp  r13d, esi      ; inSize == outSize
    ... rdx = [rdi+0x88]             ; свойство из IRP
    r9d = esi

Похоже, DSP-параметр передаётся НЕ в буфере, а в самом IOCTL/IRP —
через [rdi+0x88]. Надо понять, откуда берётся 0x88 смещение.

Практический тест: пробуем 0x80882210 с размером 4, а также
0x80882200 с разными размерами и содержимым.

БЕЗОПАСНОСТЬ: 0x80882210 — это НЕ запись DSP (запись = 0x80882204).
Проверяем только чтение/служебные. 0x80882204 не вызываем.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"

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


def ioctl(h, code, inbuf, insize, outsize):
    out = ctypes.create_string_buffer(max(outsize, 1))
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, inbuf, insize, out, outsize,
                             ctypes.byref(ret), None)
    err = ctypes.get_last_error() & 0xFFFFFFFF
    return ok, err, ret.value, bytes(out.raw[:max(outsize, 1)])


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle=0x{h:X}\n")

    # --- 0x80882210: ровно 4 байта ---
    print("=== 0x80882210 (ожидает 4 байта) ===")
    for val in (0, 1, 2, 0x10, 0x20):
        b = struct.pack("<I", val)
        ok, err, ret, out = ioctl(h, 0x80882210, b, 4, 4)
        if ok:
            print(f"  in={val:>4} OK ret={ret} out={out.hex()} as_int={struct.unpack('<I', out)[0]}")
        else:
            print(f"  in={val:>4} err=0x{err:08X}")

    # --- 0x80882200 с разными размерами ---
    print("\n=== 0x80882200 (inSize == outSize) ===")
    for size in (4, 8, 16, 24, 32):
        for val in (0, 1):
            b = ctypes.create_string_buffer(size)
            if size >= 4:
                struct.pack_into("<I", b, 0, val)
            ok, err, ret, out = ioctl(h, 0x80882200, b, size, size)
            if ok:
                print(f"  size={size:>3} val={val} OK ret={ret} out={out[:16].hex()}")
            else:
                print(f"  size={size:>3} val={val} err=0x{err:08X}")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
