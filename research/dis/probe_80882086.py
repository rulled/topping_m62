"""
Разбор структуры IOCTL 0x80882086 — это НЕ служебный запрос,
а «получить значение свойства» (так делает GetDspProperty).

Из дизассемблера 0x18000AE60..0x18000AEAD:

    buf_base = rsp + 0x58          ; 24 байта
    [rsp + 0x50] = ebx             ; out: результат (dword)
    [rsp + 0x58] = 1               ; +0x00 = режим/версия = 1
    lea r9d = 0x18                 ; inSize = 24
    mov edx = 0x80882086           ; IOCTL
    ; rdx (2-й арг) = какой-то id (сюда пришло из параметра)
    ...
    cmp dword [rsp+0x50], 1        ; если результат != 1 -> ошибка 0xEE000043

Второй фрагмент (0x18000AED0) показывает заполнение полей:

    movzx eax, byte [rcx + 0x118]
    mov   word  [rsp + 0x6a], ax    ; +0x12 = слово из контекста
    mov   word  [rsp + 0x65], dx    ; +0x0D = 0
    mov   qword [rsp + 0x58], 1     ; +0x00..0x07 = 8-байтовая 1
    mov   dword [rsp + 0x60], 1     ; +0x08 = 1
    mov   byte  [rsp + 0x64], 3     ; +0x0C = 3

ИТОГО структура (24 байта):
    off  size  значение
    0x00  8     1              (режим)
    0x08  4     1              (флаг/версия)
    0x0C  1     3              (тип операции?)
    0x0D  2     0
    0x0F  1     ?
    0x10  2     ?
    0x12  2     байт из ctx+0x118
    0x14  1     ?
    0x15  2     0
    0x17  1     0
    0x18  ---   конец (24 = 0x18)

БЕЗОПАСНОСТЬ: этот IOCTL — ЧТЕНИЕ (получает значение). Используем только его.

Запуск: python research/dis/probe_80882086.py
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

TOPPING_IFACE_GUID = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"

IOCTL_GET = 0x80882086

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_RW = 0x00000003
OPEN_EXISTING = 3
INVALID_HANDLE = ctypes.c_void_p(-1).value
DIGCF_PRESENT = 0x02
DIGCF_DEVICEINTERFACE = 0x10


class GUID(ctypes.Structure):
    _fields_ = [
        ("d1", wt.DWORD), ("d2", wt.WORD), ("d3", wt.WORD),
        ("d4", ctypes.c_ubyte * 8),
    ]


class DID(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD), ("g", GUID), ("flags", wt.DWORD),
        ("res", ctypes.c_void_p),
    ]


def parse_guid(s):
    s = s.strip("{}")
    p = s.split("-")
    g = GUID()
    g.d1 = int(p[0], 16)
    g.d2 = int(p[1], 16)
    g.d3 = int(p[2], 16)
    rest = bytes.fromhex(p[3] + p[4])
    for i, b in enumerate(rest):
        g.d4[i] = b
    return g


setupapi = ctypes.WinDLL("setupapi", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

setupapi.SetupDiGetClassDevsW.restype = ctypes.c_void_p
setupapi.SetupDiGetClassDevsW.argtypes = [
    ctypes.POINTER(GUID), wt.LPCWSTR, ctypes.c_void_p, wt.DWORD,
]
setupapi.SetupDiEnumDeviceInterfaces.restype = wt.BOOL
setupapi.SetupDiEnumDeviceInterfaces.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(GUID), wt.DWORD,
    ctypes.POINTER(DID),
]
setupapi.SetupDiGetDeviceInterfaceDetailW.restype = wt.BOOL
setupapi.SetupDiGetDeviceInterfaceDetailW.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(DID), ctypes.c_void_p, wt.DWORD,
    ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
]
kernel32.CreateFileW.restype = ctypes.c_void_p
kernel32.CreateFileW.argtypes = [
    wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD,
    ctypes.c_void_p,
]
kernel32.DeviceIoControl.restype = wt.BOOL
kernel32.DeviceIoControl.argtypes = [
    ctypes.c_void_p, wt.DWORD, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
]
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]


def open_iface():
    g = parse_guid(TOPPING_IFACE_GUID)
    h = setupapi.SetupDiGetClassDevsW(
        ctypes.byref(g), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
    )
    if h == INVALID_HANDLE:
        return None
    d = DID()
    d.cb = ctypes.sizeof(d)
    if not setupapi.SetupDiEnumDeviceInterfaces(
        h, None, ctypes.byref(g), 0, ctypes.byref(d)
    ):
        return None
    need = wt.DWORD(0)
    setupapi.SetupDiGetDeviceInterfaceDetailW(
        h, ctypes.byref(d), None, 0, ctypes.byref(need), None
    )
    buf = ctypes.create_string_buffer(need.value)
    struct.pack_into("I", buf, 0, 8)
    if not setupapi.SetupDiGetDeviceInterfaceDetailW(
        h, ctypes.byref(d), buf, need.value, ctypes.byref(need), None
    ):
        return None
    path = ctypes.wstring_at(ctypes.addressof(buf) + 4)
    return kernel32.CreateFileW(
        path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_RW,
        None, OPEN_EXISTING, 0, None,
    )


def build(prop, extra_word=0):
    """24-байтовая структура запроса."""
    b = bytearray(24)
    struct.pack_into("<Q", b, 0x00, 1)   # режим = 1
    struct.pack_into("<I", b, 0x08, 1)   # флаг = 1
    b[0x0C] = 3                          # тип
    struct.pack_into("<H", b, 0x12, extra_word)
    struct.pack_into("<I", b, 0x14, prop)  # кандидат: propId здесь
    return bytes(b)


def main():
    handle = open_iface()
    if not handle or handle == INVALID_HANDLE:
        print("интерфейс не открылся")
        return 1
    print(f"handle=0x{handle:X}")

    print("\n=== IOCTL 0x80882086 как ЧТЕНИЕ ===")
    got = 0
    for prop in range(0, 24):
        inbuf = build(prop)
        outbuf = ctypes.create_string_buffer(256)
        ret = wt.DWORD(0)
        ok = kernel32.DeviceIoControl(
            handle, IOCTL_GET, inbuf, len(inbuf), outbuf, 256,
            ctypes.byref(ret), None,
        )
        err = ctypes.get_last_error()
        if ok:
            print(f"  prop={prop:>2}  OK  returned={ret.value}  {outbuf.raw[:16].hex()}")
            got += 1
        else:
            ue = err & 0xFFFFFFFF
            print(f"  prop={prop:>2}  fail 0x{ue:08X}")
    print(f"\nуспешных: {got}/24")
    kernel32.CloseHandle(handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
