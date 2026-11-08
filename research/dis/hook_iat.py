"""
ПЕРЕХВАТ ВЕНДОРСКОЙ DLL: логируем всё, что она шлёт в драйвер.

МЕТОД: загружаем DLL в свой процесс, затем патчим её IAT —
подменяем адреса импортов (DeviceIoControl, CreateFileW,
SetupDiGetClassDevsW, SetupDiEnumDeviceInterfaces) на наши обёртки.
Обёртки пишут аргументы в лог и вызывают оригинал.

Это НЕ трогает ни файл DLL, ни драйвер, ни устройство.
Только наша копия DLL в нашей памяти.

Запуск: python research/dis/hook_iat.py
"""

import ctypes
import ctypes.wintypes as wt
import json
import struct
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

LOG = []

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
setupapi = ctypes.WinDLL("setupapi", use_last_error=True)

_DeviceIoControl = kernel32.DeviceIoControl
_CreateFileW = kernel32.CreateFileW
_SetupDiGetClassDevsW = setupapi.SetupDiGetClassDevsW
_SetupDiEnumDeviceInterfaces = setupapi.SetupDiEnumDeviceInterfaces
_SetupDiGetDeviceInterfaceDetailW = setupapi.SetupDiGetDeviceInterfaceDetailW

# --- прототипы обёрток (WinAPI x64) ---
PROTO_DeviceIoControl = ctypes.WINFUNCTYPE(
    wt.BOOL, ctypes.c_void_p, wt.DWORD, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
)
PROTO_CreateFileW = ctypes.WINFUNCTYPE(
    ctypes.c_void_p, wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
    wt.DWORD, wt.DWORD, ctypes.c_void_p,
)
PROTO_SetupDiGetClassDevsW = ctypes.WINFUNCTYPE(
    ctypes.c_void_p, ctypes.c_void_p, wt.LPCWSTR, ctypes.c_void_p, wt.DWORD,
)
PROTO_SetupDiEnumDeviceInterfaces = ctypes.WINFUNCTYPE(
    wt.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p,
)
PROTO_SetupDiGetDeviceInterfaceDetailW = ctypes.WINFUNCTYPE(
    wt.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p, ctypes.c_void_p,
)


def hx(data, limit=64):
    if not data:
        return None
    try:
        return bytes(data[:limit]).hex()
    except Exception:
        return None


@PROTO_DeviceIoControl
def hook_DeviceIoControl(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov):
    inhex = None
    if inbuf and 0 < insize <= 512:
        inhex = hx(ctypes.string_at(inbuf, insize))
    entry = {
        "call": "DeviceIoControl",
        "ioctl": f"0x{ioctl:08X}",
        "inSize": insize,
        "outSize": outsize,
        "inBuf": inhex,
    }
    ok = _DeviceIoControl(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov)
    entry["ok"] = bool(ok)
    entry["err"] = f"0x{ctypes.get_last_error() & 0xFFFFFFFF:08X}"
    if ok and outbuf and outsize:
        try:
            entry["outBuf"] = hx(ctypes.string_at(outbuf, min(outsize, 64)))
        except Exception:
            pass
    LOG.append(entry)
    return ok


@PROTO_CreateFileW
def hook_CreateFileW(path, access, share, sa, disp, flags, tmpl):
    LOG.append({
        "call": "CreateFileW",
        "path": path,
        "access": f"0x{access:08X}",
    })
    # sa может прийти как большое число -> приводим к void_p
    sa_p = ctypes.c_void_p(sa) if sa else None
    tmpl_p = ctypes.c_void_p(tmpl) if tmpl else None
    return _CreateFileW(path, access, share, sa_p, disp, flags, tmpl_p)


@PROTO_SetupDiGetClassDevsW
def hook_SetupDiGetClassDevsW(guid, enum, parent, flags):
    g = None
    if guid:
        raw = ctypes.string_at(guid, 16)
        d1, d2, d3 = struct.unpack("<IHH", raw[:8])
        g = "{%08X-%04X-%04X-%s-%s}" % (
            d1, d2, d3, raw[8:10].hex().upper(), raw[10:16].hex().upper()
        )
    LOG.append({
        "call": "SetupDiGetClassDevsW",
        "guid": g,
        "flags": f"0x{flags:08X}",
    })
    guid_p = ctypes.c_void_p(guid) if guid else None
    enum_p = ctypes.c_void_p(enum) if enum else None
    parent_p = ctypes.c_void_p(parent) if parent else None
    return _SetupDiGetClassDevsW(guid_p, enum_p, parent_p, flags)


@PROTO_SetupDiEnumDeviceInterfaces
def hook_SetupDiEnumDeviceInterfaces(sets, devinfo, guid, index, data):
    LOG.append({
        "call": "SetupDiEnumDeviceInterfaces",
        "index": index,
    })
    sets_p = ctypes.c_void_p(sets) if sets else None
    dev_p = ctypes.c_void_p(devinfo) if devinfo else None
    guid_p = ctypes.c_void_p(guid) if guid else None
    data_p = ctypes.c_void_p(data) if data else None
    return _SetupDiEnumDeviceInterfaces(sets_p, dev_p, guid_p, index, data_p)


@PROTO_SetupDiGetDeviceInterfaceDetailW
def hook_SetupDiGetDeviceInterfaceDetailW(sets, did, detail, size, needed, info):
    LOG.append({
        "call": "SetupDiGetDeviceInterfaceDetailW",
        "size": size,
    })
    a = ctypes.c_void_p(sets) if sets else None
    b = ctypes.c_void_p(did) if did else None
    c = ctypes.c_void_p(detail) if detail else None
    e = ctypes.c_void_p(needed) if needed else None
    f = ctypes.c_void_p(info) if info else None
    return _SetupDiGetDeviceInterfaceDetailW(a, b, c, size, e, f)


# --- патчинг IAT ---
def patch_iat(module_base, dll_name, func_name, new_addr):
    """
    Находит в таблице импорта модуля запись dll_name!func_name
    и заменяет адрес на new_addr. Возвращает True при успехе.
    """
    IMAGE_DOS_SIGNATURE = 0x5A4D
    IMAGE_NT_SIGNATURE = 0x00004550

    dos = ctypes.string_at(module_base, 64)
    if struct.unpack("<H", dos[:2])[0] != IMAGE_DOS_SIGNATURE:
        return False
    e_lfanew = struct.unpack("<I", dos[0x3C:0x40])[0]
    nt = ctypes.string_at(module_base + e_lfanew, 264)
    if struct.unpack("<I", nt[:4])[0] != IMAGE_NT_SIGNATURE:
        return False

    opt_off = 4 + 20
    magic = struct.unpack("<H", nt[opt_off:opt_off + 2])[0]
    is64 = magic == 0x20B
    # DataDirectory[1] = Import
    dd_off = opt_off + (112 if is64 else 96)
    imp_rva, imp_size = struct.unpack("<II", nt[dd_off + 8:dd_off + 16])
    if imp_rva == 0:
        return False

    rva = imp_rva
    thunk_size = 8 if is64 else 4
    while True:
        desc = ctypes.string_at(module_base + rva, 20)
        if len(desc) < 20:
            break
        oft, ts, fc, name_rva, ft = struct.unpack("<IIIII", desc)
        if name_rva == 0:
            break
        mod_name = ctypes.string_at(module_base + name_rva).decode(
            "ascii", "replace"
        )
        if dll_name.lower() in mod_name.lower():
            # проходим thunks
            t = oft if oft else ft
            i = 0
            while True:
                thunk = ctypes.string_at(module_base + t + i * thunk_size, thunk_size)
                val = struct.unpack("<Q" if is64 else "<I", thunk)[0]
                if val == 0:
                    break
                if not (val & (1 << (63 if is64 else 31))):
                    # это RVA на IMAGE_IMPORT_BY_NAME
                    hint = ctypes.string_at(module_base + val + 2)
                    fn = hint.split(b"\x00", 1)[0].decode("ascii", "replace")
                    if fn == func_name:
                        iat_addr = module_base + ft + i * thunk_size
                        old = ctypes.c_ulonglong.from_address(iat_addr).value
                        # IAT лежит на read-only странице -> снимаем защиту
                        old_prot = wt.DWORD(0)
                        kernel32.VirtualProtect(
                            ctypes.c_void_p(iat_addr), thunk_size,
                            0x04,  # PAGE_READWRITE
                            ctypes.byref(old_prot),
                        )
                        ctypes.c_ulonglong.from_address(iat_addr).value = new_addr
                        kernel32.VirtualProtect(
                            ctypes.c_void_p(iat_addr), thunk_size,
                            old_prot.value,
                            ctypes.byref(old_prot),
                        )
                        print(f"    патч {mod_name}!{func_name}: "
                              f"0x{old:X} -> 0x{new_addr:X}")
                        return True
                i += 1
        rva += 20
    return False


def main():
    print("=== загрузка DLL ===")
    dll = ctypes.WinDLL(DLL_PATH)
    base = dll._handle
    print(f"  база 0x{base:X}")

    print("\n=== патчим IAT ===")
    targets = [
        ("KERNEL32", "DeviceIoControl", ctypes.cast(hook_DeviceIoControl, ctypes.c_void_p).value),
        ("KERNEL32", "CreateFileW", ctypes.cast(hook_CreateFileW, ctypes.c_void_p).value),
        ("SETUPAPI", "SetupDiGetClassDevsW", ctypes.cast(hook_SetupDiGetClassDevsW, ctypes.c_void_p).value),
        ("SETUPAPI", "SetupDiEnumDeviceInterfaces", ctypes.cast(hook_SetupDiEnumDeviceInterfaces, ctypes.c_void_p).value),
        ("SETUPAPI", "SetupDiGetDeviceInterfaceDetailW", ctypes.cast(hook_SetupDiGetDeviceInterfaceDetailW, ctypes.c_void_p).value),
    ]
    for dllname, fn, addr in targets:
        ok = patch_iat(base, dllname, fn, addr)
        if not ok:
            print(f"    НЕ найден {dllname}!{fn}")

    print("\n=== вызываем API ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  EnumerateDevices -> 0x{rc & 0xFFFFFFFF:08X}")

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  GetDeviceCount -> 0x{rc & 0xFFFFFFFF:08X}, count={cnt.value}")

    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [
        ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)
    ]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    print(f"  OpenDeviceByIndex -> 0x{rc & 0xFFFFFFFF:08X}, handle=0x{handle.value or 0:X}")

    if handle.value:
        dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetDspProperty.argtypes = [
            ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
        ]
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDspProperty(0, buf, 256)
        print(f"  GetDspProperty(0) -> 0x{rc & 0xFFFFFFFF:08X}")
        dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
        dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
        dll.TUSBAUDIO_CloseDevice(handle)

    print(f"\n=== ЛОГ ({len(LOG)} событий) ===")
    for e in LOG:
        print(json.dumps(e, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
