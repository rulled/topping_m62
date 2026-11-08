"""
Проверка: доступны ли DSP-IOCTL при РАБОТАЮЩЕМ M Control Center.

Логика: MCC при старте инициализирует DSP (шлёт свои IOCTL).
Драйвер держит бит занятости [0x140065060]+0x120:
   бит 19 -> проверяется ЧТЕНИЕМ  (0x80882200)
   бит 18 -> проверяется ЗАПИСЬЮ  (0x80882204)
Сейчас оба дают 0xEE000030 («операция идёт»).

Гипотеза: с запущенным MCC DSP уже инициализирован, и чтение
свойств проходит.

БЕЗОПАСНОСТЬ: только ЧТЕНИЕ (0x80882200) и 0x80882210.
Запись 0x80882204 НЕ вызывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import subprocess
import sys
import time

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200
IOCTL_VERS = 0x80882210

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
INVALID_HANDLE = ctypes.c_void_p(-1).value

MCC = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


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
    size = max(size, 4)
    b = ctypes.create_string_buffer(size)
    struct.pack_into("<I", b, 0, fill)
    out = ctypes.create_string_buffer(size)
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, b, size, out, size,
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, bytes(out.raw[:size])


def mcc_running():
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
        capture_output=True, text=True, timeout=20,
    )
    try:
        return int(out.stdout.strip()) > 0
    except ValueError:
        return False


def full_probe(label):
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print(f"  {label}: устройство не открылось")
        return
    print(f"  {label}: handle=0x{h:X}")

    # чтение DSP: пробуем разные размеры и значения
    found = 0
    for size in (4, 8, 16, 24, 32):
        for fill in (0, 1, 2):
            ok, err, out = call(h, IOCTL_GET, size, fill)
            if ok:
                print(f"    GET size={size:>3} fill={fill} -> OK {out[:16].hex()}")
                found += 1
            elif err != 0xEE000030:
                print(f"    GET size={size:>3} fill={fill} -> 0x{err:08X}")
    if found == 0:
        ok, err, _ = call(h, IOCTL_GET, 4, 0)
        print(f"    GET: ни одного успеха (последний код 0x{err:08X})")

    ok, err, out = call(h, IOCTL_VERS, 4, 0)
    print(f"    VERS: {'OK' if ok else f'0x{err:08X}'}")
    k32.CloseHandle(h)


def main():
    print("=== 1. MCC ВЫКЛЮЧЕН ===")
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue"],
                   capture_output=True, timeout=30)
    time.sleep(3)
    print(f"  MCC запущен: {mcc_running()}")
    full_probe("без MCC")

    print("\n=== 2. ЗАПУСКАЕМ MCC ===")
    subprocess.Popen([MCC])
    for i in range(20):
        time.sleep(2)
        if mcc_running():
            print(f"  MCC поднялся за ~{(i + 1) * 2}с")
            break
    time.sleep(6)
    print(f"  MCC запущен: {mcc_running()}")
    full_probe("с MCC")

    print("\n=== 3. ждём ещё 10 с ===")
    time.sleep(10)
    full_probe("с MCC (+10с)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
