"""
Проверка: можно ли САМИМ открыть вендорский канал и получить таблицу
DSP-свойств, без M Control Center.

Канал: {E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}
IOCTL: 0x80882200 (GetDspProperty), 0x80882204 (SetDspProperty)

БЕЗОПАСНОСТЬ: на этом шаге НИЧЕГО не пишем (0x80882204 не используется).
Только открываем handle и пробуем несколько ЧИТАЮЩИХ IOCTL из найденной
карты. Если чтение не удаётся — ничего страшного, устройство не тронуто.

Запуск: python research/dis/probe_channel.py
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

GUID = "{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_RW = 0x00000003
OPEN_EXISTING = 3
INVALID_HANDLE = ctypes.c_void_p(-1).value

DIGCF_PRESENT = 0x02
DIGCF_DEVICEINTERFACE = 0x10


class GUIDStruct(ctypes.Structure):
    _fields_ = [
        ("Data1", wt.DWORD),
        ("Data2", wt.WORD),
        ("Data3", wt.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]

    @classmethod
    def parse(cls, s):
        s = s.strip("{}")
        p = s.split("-")
        g = cls()
        g.Data1 = int(p[0], 16)
        g.Data2 = int(p[1], 16)
        g.Data3 = int(p[2], 16)
        rest = bytes.fromhex(p[3] + p[4])
        for i, b in enumerate(rest):
            g.Data4[i] = b
        return g


class SP_DEVICE_INTERFACE_DATA(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.DWORD),
        ("InterfaceClassGuid", GUIDStruct),
        ("Flags", wt.DWORD),
        ("Reserved", ctypes.c_void_p),
    ]


setupapi = ctypes.WinDLL("setupapi", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

setupapi.SetupDiGetClassDevsW.restype = ctypes.c_void_p
setupapi.SetupDiGetClassDevsW.argtypes = [
    ctypes.POINTER(GUIDStruct), wt.LPCWSTR, ctypes.c_void_p, wt.DWORD,
]
setupapi.SetupDiEnumDeviceInterfaces.restype = wt.BOOL
setupapi.SetupDiEnumDeviceInterfaces.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(GUIDStruct),
    wt.DWORD, ctypes.POINTER(SP_DEVICE_INTERFACE_DATA),
]
setupapi.SetupDiGetDeviceInterfaceDetailW.restype = wt.BOOL
setupapi.SetupDiGetDeviceInterfaceDetailW.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(SP_DEVICE_INTERFACE_DATA),
    ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
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


def find_paths():
    g = GUIDStruct.parse(GUID)
    h = setupapi.SetupDiGetClassDevsW(
        ctypes.byref(g), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
    )
    if h == INVALID_HANDLE:
        return []
    out = []
    i = 0
    while True:
        did = SP_DEVICE_INTERFACE_DATA()
        did.cbSize = ctypes.sizeof(did)
        if not setupapi.SetupDiEnumDeviceInterfaces(
            h, None, ctypes.byref(g), i, ctypes.byref(did)
        ):
            break
        need = wt.DWORD(0)
        setupapi.SetupDiGetDeviceInterfaceDetailW(
            h, ctypes.byref(did), None, 0, ctypes.byref(need), None
        )
        buf = ctypes.create_string_buffer(need.value)
        # cbSize = 8 для x64, но записываем 4 младших + padding
        struct.pack_into("I", buf, 0, 8)
        if setupapi.SetupDiGetDeviceInterfaceDetailW(
            h, ctypes.byref(did), buf, need.value, ctypes.byref(need), None
        ):
            path = ctypes.wstring_at(ctypes.addressof(buf) + 4)
            out.append(path)
        i += 1
    return out


def main():
    print("=== поиск канала ===")
    paths = find_paths()
    if not paths:
        print("интерфейс не найден")
        return 1
    for p in paths:
        print(f"  {p}")

    path = paths[0]
    print("\n=== открытие ===")
    h = kernel32.CreateFileW(
        path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_RW,
        None, OPEN_EXISTING, 0, None,
    )
    if h == INVALID_HANDLE:
        err = ctypes.get_last_error()
        print(f"  CreateFileW FAILED, err={err}")
        return 1
    print(f"  OK, handle=0x{h:X}")

    # --- пробуем ЧИТАЮЩИЕ ioctl-ы ---
    # GetDspProperty = 0x80882200 (METHOD_BUFFERED)
    print("\n=== чтение: GetDspProperty (0x80882200) ===")
    for prop in (0, 1, 2, 0x100, 0x101):
        inbuf = struct.pack("<I", prop)
        outbuf = ctypes.create_string_buffer(512)
        ret = wt.DWORD(0)
        ok = kernel32.DeviceIoControl(
            h, 0x80882200,
            inbuf, len(inbuf),
            outbuf, 512,
            ctypes.byref(ret), None,
        )
        err = ctypes.get_last_error()
        if ok:
            data = outbuf.raw[: ret.value]
            print(f"  prop=0x{prop:X} OK returned={ret.value} bytes={data[:32].hex()}")
        else:
            print(f"  prop=0x{prop:X} fail err={err}")

    # --- пробуем «перечислить свойства» (0x80882086 — 6 вхождений в DLL) ---
    print("\n=== чтение: пробуем 0x80882086 (возможно, перечисление) ===")
    outbuf = ctypes.create_string_buffer(4096)
    ret = wt.DWORD(0)
    ok = kernel32.DeviceIoControl(
        h, 0x80882086, None, 0, outbuf, 4096, ctypes.byref(ret), None,
    )
    err = ctypes.get_last_error()
    print(f"  ok={bool(ok)} err={err} returned={ret.value}")
    if ok:
        print(f"  первые 64 байта: {outbuf.raw[:64].hex()}")

    kernel32.CloseHandle(h)
    print("\nhandle закрыт")
    return 0


if __name__ == "__main__":
    sys.exit(main())
