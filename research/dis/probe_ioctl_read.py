"""
Попытка прочитать DSP-свойства через DeviceIoControl напрямую,
минуя вендорскую DLL.

ЧТО УЖЕ ИЗВЕСТНО (из дизассемблера):
  IOCTL чтения  = 0x80882200 (METHOD_BUFFERED)
  IOCTL записи  = 0x80882204 (METHOD_IN_DIRECT)

  Сигнатура Set/GetDspProperty(propId, buf, size) — БЕЗ handle,
  потому что DLL подставляет свой контекст.

  Значит DeviceIoControl, скорее всего, принимает:
     inBuf  = [ propId (4) + размер/данные ]
     outBuf = значение

  Ранее я слал только propId (4 байта) — драйвер отвечал 0xEE000003.

ГИПОТЕЗА: inBuf — та же 24-байтовая структура, что в DLL для
0x80882086:  [0x28] .. [0x40], база rsp+0x58.

БЕЗОПАСНОСТЬ: используется ТОЛЬКО IOCTL ЧТЕНИЯ (0x80882200).
Запись (0x80882204) не вызывается ни при каких условиях.

Запуск: python research/dis/probe_ioctl_read.py
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

USB_DEVICE_GUID = "{a5dcbf10-6530-11d2-901f-00c04fb951ed}"
TOPPING_IFACE_GUID = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"

IOCTL_GET_DSP = 0x80882200

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


def enum_paths(guid_str):
    g = parse_guid(guid_str)
    h = setupapi.SetupDiGetClassDevsW(
        ctypes.byref(g), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
    )
    if h == INVALID_HANDLE:
        return []
    out = []
    i = 0
    while True:
        d = DID()
        d.cb = ctypes.sizeof(d)
        if not setupapi.SetupDiEnumDeviceInterfaces(
            h, None, ctypes.byref(g), i, ctypes.byref(d)
        ):
            break
        need = wt.DWORD(0)
        setupapi.SetupDiGetDeviceInterfaceDetailW(
            h, ctypes.byref(d), None, 0, ctypes.byref(need), None
        )
        buf = ctypes.create_string_buffer(need.value)
        struct.pack_into("I", buf, 0, 8)
        if setupapi.SetupDiGetDeviceInterfaceDetailW(
            h, ctypes.byref(d), buf, need.value, ctypes.byref(need), None
        ):
            out.append(ctypes.wstring_at(ctypes.addressof(buf) + 4))
        i += 1
    return out


def main():
    print("=== ищем M62 ===")
    usb_paths = [p for p in enum_paths(USB_DEVICE_GUID)
                 if "152a" in p.lower() and "875c" in p.lower()]
    print(f"  по USB_DEVICE: найдено {len(usb_paths)}")
    for p in usb_paths:
        print(f"    {p}")

    iface_paths = enum_paths(TOPPING_IFACE_GUID)
    print(f"  по Topping-интерфейсу: найдено {len(iface_paths)}")
    for p in iface_paths:
        print(f"    {p}")

    if not iface_paths:
        print("\nнет вендорского интерфейса — стоп")
        return 1

    path = iface_paths[0]
    print(f"\n=== открываем {path[:80]}... ===")
    h = kernel32.CreateFileW(
        path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_RW,
        None, OPEN_EXISTING, 0, None,
    )
    if h == INVALID_HANDLE:
        print(f"  FAILED err={ctypes.get_last_error()}")
        return 1
    print(f"  OK handle=0x{h:X}")

    print("\n=== пробуем ЧИТАЮЩИЙ IOCTL 0x80882200 с разными inBuf ===")

    # вариант 1: только propId (4 байта)
    # вариант 2: 24 байта, propId в разных смещениях
    variants = []
    for prop in (0, 1, 2):
        for off in (0, 4, 8, 0x10):
            buf = bytearray(24)
            struct.pack_into("<I", buf, off, prop)
            variants.append((f"prop={prop} @off {off:#04x}", bytes(buf)))

    # вариант 3: структура как в DLL: [0x08]=1, [0x10]=prop
    for prop in (0, 1, 2):
        buf = bytearray(24)
        struct.pack_into("<I", buf, 0x08, 1)
        struct.pack_into("<I", buf, 0x10, prop)
        variants.append((f"DLL-style prop={prop}", bytes(buf)))

    ok_any = False
    for label, inbuf in variants:
        outbuf = ctypes.create_string_buffer(256)
        ret = wt.DWORD(0)
        ok = kernel32.DeviceIoControl(
            h, IOCTL_GET_DSP,
            inbuf, len(inbuf),
            outbuf, 256,
            ctypes.byref(ret), None,
        )
        err = ctypes.get_last_error()
        if ok and ret.value:
            data = outbuf.raw[: ret.value]
            print(f"  {label:<26} OK returned={ret.value} hex={data[:24].hex()}")
            ok_any = True
        elif ok:
            print(f"  {label:<26} OK but returned=0")
        else:
            if err not in (0x57, 0x1F):  # скрываем шум
                print(f"  {label:<26} fail err=0x{err:08X}")

    if not ok_any:
        print("\n  ни один вариант не дал данных")
        print("  (только IOCTL ЧТЕНИЯ; запись не вызывалась)")

    kernel32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
