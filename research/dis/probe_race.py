"""
ФИНАЛЬНАЯ проверка бита занятости: не снимается ли он «рукой» —
если открыть handle ДО старта MCC, а потом MCC инициализирует DSP.

Логика: бит отражает внутреннее состояние драйвера. Возможно, он
устанавливается при закрытии предыдущей операции и сбрасывается
только по завершении URB. Если держать handle открытым всё время,
пока MCC работает, можно поймать момент, когда бит свободен.

МЕТОД: держим handle, в цикле пробуем 0x80882200 каждые 100 мс
в течение 30 с, параллельно MCC работает и шлёт свои IOCTL.
Если хоть раз получим не 0xEE000030 — фиксируем.

БЕЗОПАСНОСТЬ: только ЧТЕНИЕ (0x80882200). Запись не вызывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import subprocess
import sys
import time

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200

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


def try_get(h, size=4, fill=0):
    b = ctypes.create_string_buffer(max(size, 4))
    struct.pack_into("<I", b, 0, fill)
    out = ctypes.create_string_buffer(max(size, 4))
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, IOCTL_GET, b, max(size, 4), out, max(size, 4),
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, bytes(out.raw[:max(size, 4)])


def main():
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue"],
                   capture_output=True, timeout=30)
    time.sleep(2)

    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle={h:#x} (держим открытым)")

    # стартуем MCC в фоне
    print("запускаем MCC...")
    subprocess.Popen([MCC])

    seen = {}
    successes = 0
    t0 = time.time()

    print("\n=== цикл: 300 попыток по 100 мс ===")
    for i in range(300):
        for size, fill in ((4, 0), (24, 0), (132, 0)):
            ok, err, out = try_get(h, size, fill)
            if ok:
                successes += 1
                print(f"  УСПЕХ на {i}: size={size} fill={fill} -> {out[:24].hex()}")
            else:
                seen[err] = seen.get(err, 0) + 1
        time.sleep(0.1)

    dt = time.time() - t0
    print(f"\nпрошло {dt:.1f} с, успехов: {successes}")
    print("коды ошибок за цикл:")
    for e, n in sorted(seen.items(), key=lambda x: -x[1]):
        print(f"  0x{e:08X}  x{n}")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
