"""
РЕШАЮЩАЯ ПРОВЕРКА: из обработчика 0x140027594 (GetDspProperty).

Ключевая инструкция:
    0x1400275A2: cmp r13d, esi
    0x1400275A5: je  <ok>
    0x1400275A7: mov r14d, 0xee000043     ; <-- НАША ОШИБКА
    0x1400275AD: jmp <return>

где:
    esi = inSize  (InputBufferLength)
    r13d = outSize (OutputBufferLength)

То есть 0xEE000043 = «inSize != outSize». Я передавал inSize=24,
outSize=256 — отсюда ошибка!

Далее:
    rdx = [rdi + 0x88]        ; свойство/контекст
    r8  = r12                 ; буфер
    r9d = esi                 ; размер
    call [rcx] + 0x70         ; драйверное чтение

Значит: inBuf и outBuf должны быть ОДНОГО размера, а данные идут
через r12 (буфер запроса).

Проверяем: подаём одинаковые inSize/outSize.
БЕЗОПАСНОСТЬ: это ЧТЕНИЕ (0x80882200). Запись не вызывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200

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
k32.CloseHandle.argtypes = [ctypes.c_void_p]


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


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle=0x{h:X}")

    # inSize == outSize (как требует обработчик)
    for size in (24, 32, 64, 128, 256):
        print(f"\n=== size={size} (inSize == outSize) ===")
        for prop in (0, 1, 2, 3):
            inbuf = ctypes.create_string_buffer(size)
            # пробуем положить propId в начало
            struct.pack_into("<I", inbuf, 0, prop)
            outbuf = ctypes.create_string_buffer(size)
            ret = wt.DWORD(0)
            ok = k32.DeviceIoControl(h, IOCTL_GET, inbuf, size,
                                     outbuf, size, ctypes.byref(ret), None)
            err = ctypes.get_last_error() & 0xFFFFFFFF
            if ok:
                print(f"  prop={prop} OK ret={ret.value} out={outbuf.raw[:16].hex()}")
            else:
                print(f"  prop={prop} err=0x{err:08X}")

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
