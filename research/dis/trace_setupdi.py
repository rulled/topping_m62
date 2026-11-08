"""
Прямая проверка: что SetupAPI отдаёт для нашего GUID в этом процессе,
и в каком месте DLL останавливается.

Перехватываем SetupDiGetClassDevsW / SetupDiEnumDeviceInterfaces /
SetupDiGetDeviceInterfaceDetailW и печатаем ВОЗВРАЩАЕМЫЕ значения.
Это покажет, на каком шаге цепочка обрывается.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
setupapi = ctypes.WinDLL("setupapi", use_last_error=True)

_GD = setupapi.SetupDiGetClassDevsW
_EI = setupapi.SetupDiEnumDeviceInterfaces
_DD = setupapi.SetupDiGetDeviceInterfaceDetailW

P_GD = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, wt.LPCWSTR,
                          ctypes.c_void_p, wt.DWORD)
P_EI = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, wt.DWORD, ctypes.c_void_p)
P_DD = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, wt.DWORD, ctypes.c_void_p,
                          ctypes.c_void_p)


@P_GD
def h_gd(guid, enum, parent, flags):
    r = _GD(ctypes.c_void_p(guid) if guid else None,
            ctypes.c_void_p(enum) if enum else None,
            ctypes.c_void_p(parent) if parent else None, flags)
    err = ctypes.get_last_error()
    print(f"    [GD] flags=0x{flags:04X} -> set=0x{r:X} err={err}")
    return r


@P_EI
def h_ei(sets, devinfo, guid, index, data):
    r = _EI(ctypes.c_void_p(sets) if sets else None,
            ctypes.c_void_p(devinfo) if devinfo else None,
            ctypes.c_void_p(guid) if guid else None, index,
            ctypes.c_void_p(data) if data else None)
    err = ctypes.get_last_error()
    print(f"    [EI] index={index} -> {bool(r)} err={err}")
    return r


@P_DD
def h_dd(sets, did, detail, size, needed, info):
    r = _DD(ctypes.c_void_p(sets) if sets else None,
            ctypes.c_void_p(did) if did else None,
            ctypes.c_void_p(detail) if detail else None, size,
            ctypes.c_void_p(needed) if needed else None,
            ctypes.c_void_p(info) if info else None)
    err = ctypes.get_last_error()
    print(f"    [DD] size={size} -> {bool(r)} err={err}")
    return r


def patch_iat(base, dll_name, func_name, new_addr):
    dos = ctypes.string_at(base, 64)
    if struct.unpack("<H", dos[:2])[0] != 0x5A4D:
        return False
    e_lfanew = struct.unpack("<I", dos[0x3C:0x40])[0]
    nt = ctypes.string_at(base + e_lfanew, 264)
    opt_off = 4 + 20
    is64 = struct.unpack("<H", nt[opt_off:opt_off + 2])[0] == 0x20B
    dd_off = opt_off + (112 if is64 else 96)
    imp_rva, _ = struct.unpack("<II", nt[dd_off + 8:dd_off + 16])
    if not imp_rva:
        return False
    rva = imp_rva
    ts = 8 if is64 else 4
    while True:
        oft, t2, fc, name_rva, ft = struct.unpack(
            "<IIIII", ctypes.string_at(base + rva, 20)
        )
        if name_rva == 0:
            break
        mod = ctypes.string_at(base + name_rva).decode("ascii", "replace")
        if dll_name.lower() in mod.lower():
            t = oft if oft else ft
            i = 0
            while True:
                val = struct.unpack(
                    "<Q" if is64 else "<I",
                    ctypes.string_at(base + t + i * ts, ts)
                )[0]
                if val == 0:
                    break
                if not (val & (1 << (63 if is64 else 31))):
                    fn = ctypes.string_at(base + val + 2).split(b"\x00", 1)[0].decode(
                        "ascii", "replace"
                    )
                    if fn == func_name:
                        a = base + ft + i * ts
                        op = wt.DWORD(0)
                        kernel32.VirtualProtect(ctypes.c_void_p(a), ts, 4, ctypes.byref(op))
                        ctypes.c_ulonglong.from_address(a).value = new_addr
                        kernel32.VirtualProtect(ctypes.c_void_p(a), ts, op.value, ctypes.byref(op))
                        return True
                i += 1
        rva += 20
    return False


def main():
    print("=== наш собственный вызов SetupAPI для сравнения ===")
    from research.dis.probe_ioctl_read import parse_guid, enum_paths
    paths = enum_paths("{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}")
    print(f"  наш enum_paths -> {len(paths)} путей")

    print("\n=== загружаем DLL и патчим SetupAPI ===")
    dll = ctypes.WinDLL(DLL_PATH)
    base = dll._handle
    for fn, hk in (
        ("SetupDiGetClassDevsW", h_gd),
        ("SetupDiEnumDeviceInterfaces", h_ei),
        ("SetupDiGetDeviceInterfaceDetailW", h_dd),
    ):
        ok = patch_iat(base, "SETUPAPI", fn, ctypes.cast(hk, ctypes.c_void_p).value)
        print(f"  {fn}: {'патч OK' if ok else 'НЕ найден'}")

    print("\n=== трасса SetupAPI внутри DLL ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  EnumerateDevices -> 0x{rc & 0xFFFFFFFF:08X}")

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  GetDeviceCount -> 0x{rc & 0xFFFFFFFF:08X} count={cnt.value}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, r"E:\Programming shit\Topping")
    sys.exit(main())
