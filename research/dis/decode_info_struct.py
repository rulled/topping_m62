"""
Разбор рабочего IOCTL 0x80882100 (132 байта = 0x84).

Ответ: 02000000 44ac0000 80bb0000 ...
       2, 0xAC44=44100, 0xBB80=48000  <- похоже sample rates!

Из дизассемблера handler 0x140026D33:
    cmp  esi, 0x84          ; inSize == 132
    cmp  [r15+0x4c4], 1     ; состояние 1
    movzx r8d, byte [r15+0x644]
    rdx = r12               ; outBuf
    rcx = r15
    call 0x1400339C0        ; заполняет структуру
    esi = 0x84
    ret = 0x84

Значит outBuf получает 132-байтовую структуру «информация об устройстве».

Здесь: читаем её и разбираем по полям (dword + массив).

БЕЗОПАСНОСТЬ: только чтение.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_INFO = 0x80882100
IOCTL_VER = 0x80882004

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


def ioctl(h, code, insize, outsize):
    b = ctypes.create_string_buffer(max(insize, 1))
    out = ctypes.create_string_buffer(max(outsize, 1))
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, b, insize, out, outsize,
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, bytes(out.raw[:ret.value])


def dump_struct(data, title):
    print(f"\n=== {title}: {len(data)} байт ===")
    if not data:
        return
    print("  hex:", data.hex())
    print("\n  как dword (LE):")
    for off in range(0, len(data) - 3, 4):
        v = struct.unpack_from("<I", data, off)[0]
        note = ""
        if v in (44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000):
            note = f"  <- sample rate {v} Hz"
        elif 0 < v < 32:
            note = f"  (возможно счётчик/флаг = {v})"
        print(f"    +0x{off:02X}  {v:>12}  0x{v:08X}{note}")


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle={h:#x}")

    ok, err, data = ioctl(h, IOCTL_VER, 0x18, 0x18)
    print(f"\n0x80882004 (версии): {'OK' if ok else f'0x{err:08X}'}")
    if ok:
        dump_struct(data, "0x80882004")

    ok, err, data = ioctl(h, IOCTL_INFO, 0x84, 0x84)
    print(f"\n0x80882100 (информация): {'OK' if ok else f'0x{err:08X}'}")
    if ok:
        dump_struct(data, "0x80882100")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
