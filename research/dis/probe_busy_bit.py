"""
Проверка: меняется ли поведение DSP-IOCTL при разных условиях.

Из дизассемблера:
   - ЧТЕНИЕ  (0x80882200) проверяет бит 19 глобала [0x140065060]+0x120
   - ЗАПИСЬ  (0x80882204) проверяет бит 18
   - 0xEE000030 = «бит занятости установлен»

Оба сейчас дают 0xEE000030 => бит считает, что идёт операция.

Проверяем:
  1. многократные вызовы с паузами (может, флаг сбрасывается позже);
  2. после `Load preset` через HID (переинициализация устройства);
  3. после открытия/закрытия аудиопотока;
  4. 0x80882210 (работает) — не влияет ли его вызов на флаг.

БЕЗОПАСНОСТЬ:
  - вызываем ТОЛЬКО читающие IOCTL (0x80882200, 0x80882210);
  - запись 0x80882204 НЕ вызывается;
  - HID-команда Load preset безопасна (перезагружает текущий пресет);
  - выходы проверяются: если подключены — звуковой тест пропускается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys
import time

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200
IOCTL_VERS = 0x80882210

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


def call(h, code, size, fill=0):
    b = ctypes.create_string_buffer(size)
    struct.pack_into("<I", b, 0, fill)
    out = ctypes.create_string_buffer(size)
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, b, size, out, size,
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, bytes(out.raw[:size])


def probe(h, label):
    ok, err, out = call(h, IOCTL_GET, 4, 0)
    vok, verr, vout = call(h, IOCTL_VERS, 4, 0)
    a = "OK " if ok else f"0x{err:08X}"
    b = "OK " if vok else f"0x{verr:08X}"
    print(f"  {label:<34} get={a:<11} vers={b}")
    return ok


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle=0x{h:X}\n")

    print("=== 1. многократно с паузами ===")
    for i in range(6):
        probe(h, f"попытка {i + 1}")
        time.sleep(0.7)

    print("\n=== 2. после вызова 0x80882210 ===")
    for v in (0, 1, 2):
        call(h, IOCTL_VERS, 4, v)
    probe(h, "сразу после vers")

    print("\n=== 3. с разными размерами буфера ===")
    for size in (1, 2, 4, 8, 24, 256, 1024):
        ok, err, out = call(h, IOCTL_GET, size, 0)
        print(f"  size={size:>5} -> {'OK' if ok else f'0x{err:08X}'}")

    print("\n=== 4. с нулевым указателем (inSize=0, outSize=4) ===")
    out = ctypes.create_string_buffer(4)
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, IOCTL_GET, None, 0, out, 4,
                             ctypes.byref(ret), None)
    print(f"  inSize=0 outSize=4 -> {'OK' if ok else f'0x{ctypes.get_last_error() & 0xFFFFFFFF:08X}'}")

    print("\n=== 5. только out, без in (outSize=0) ===")
    b = ctypes.create_string_buffer(4)
    ok = k32.DeviceIoControl(h, IOCTL_GET, b, 4, None, 0,
                             ctypes.byref(ret), None)
    print(f"  inSize=4 outSize=0 -> {'OK' if ok else f'0x{ctypes.get_last_error() & 0xFFFFFFFF:08X}'}")

    k32.CloseHandle(h)
    print("\nhandle закрыт")
    return 0


if __name__ == "__main__":
    sys.exit(main())
