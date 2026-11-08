"""
Логируем ВОЗВРАЩАЕМЫЕ значения SetupAPI внутри вендорской DLL.

Вопрос: почему `SetupDiEnumDeviceInterfaces` вообще не вызывается,
хотя `SetupDiGetClassDevsW` с нашим GUID вызывается?

Из дизассемблера 0x180004330:
    0x180004393: call SetupDiGetClassDevsW
    0x180004399: lea  rcx, [rax - 1]
    0x18000439D: cmp  rcx, -3
    0x1800043A1: ja   0x1800044B1        ; <-- выход при rax == 0 или -1
    0x1800043A7: mov  [rbx + 8], rax

То есть при `rax == 0` или `rax == INVALID_HANDLE_VALUE` цепочка
обрывается ДО перечисления интерфейсов.

Здесь: печатаем фактические возвраты, чтобы это подтвердить.
Патчим через ячейки IAT и восстанавливаем их после каждого вызова
(чтобы не сломать внутреннюю логику DLL).

БЕЗОПАСНОСТЬ: только чтение/перечисление, устройство не трогаем.
"""

import ctypes
import ctypes.wintypes as wt
import struct
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
sa = ctypes.WinDLL("setupapi", use_last_error=True)

_GD = sa.SetupDiGetClassDevsW
_EI = sa.SetupDiEnumDeviceInterfaces
_DD = sa.SetupDiGetDeviceInterfaceDetailW
_DL = sa.SetupDiDestroyDeviceInfoList

EVENTS = []

P_GD = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, wt.LPCWSTR,
                          ctypes.c_void_p, wt.DWORD)
P_EI = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, wt.DWORD, ctypes.c_void_p)
P_DD = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, wt.DWORD, ctypes.c_void_p,
                          ctypes.c_void_p)


def guid_str(ptr):
    try:
        raw = ctypes.string_at(ptr, 16)
    except Exception:
        return None
    d1, d2, d3 = struct.unpack("<IHH", raw[:8])
    return "{%08X-%04X-%04X-%s-%s}" % (
        d1, d2, d3, raw[8:10].hex().upper(), raw[10:16].hex().upper()
    )


@P_GD
def h_gd(guid, enum, parent, flags):
    r = _GD(ctypes.c_void_p(guid) if guid else None,
            ctypes.c_void_p(enum) if enum else None,
            ctypes.c_void_p(parent) if parent else None, flags)
    e = ctypes.get_last_error()
    ev = {"fn": "GetClassDevs", "guid": guid_str(guid) if guid else None,
          "flags": f"0x{flags:04X}",
          "ret": f"0x{r:X}" if r else "0x0",
          "err": e,
          "invalid": (r in (0, 0xFFFFFFFFFFFFFFFF) or not r)}
    EVENTS.append(ev)
    print(f"  [GetClassDevs] guid={ev['guid']} flags=0x{flags:04X} "
          f"-> {ev['ret']} err={e} {'<<< FAIL' if ev['invalid'] else ''}")
    return r


@P_EI
def h_ei(sets, devinfo, guid, index, data):
    r = _EI(ctypes.c_void_p(sets) if sets else None,
            ctypes.c_void_p(devinfo) if devinfo else None,
            ctypes.c_void_p(guid) if guid else None, index,
            ctypes.c_void_p(data) if data else None)
    e = ctypes.get_last_error()
    print(f"  [EnumInterfaces] index={index} -> {bool(r)} err={e}")
    return r


@P_DD
def h_dd(sets, did, detail, size, needed, info):
    r = _DD(ctypes.c_void_p(sets) if sets else None,
            ctypes.c_void_p(did) if did else None,
            ctypes.c_void_p(detail) if detail else None, size,
            ctypes.c_void_p(needed) if needed else None,
            ctypes.c_void_p(info) if info else None)
    e = ctypes.get_last_error()
    print(f"  [InterfaceDetail] size={size} -> {bool(r)} err={e}")
    return r


def patch_iat(base, dll_name, func_name, new_addr):
    dos = ctypes.string_at(base, 64)
    if struct.unpack("<H", dos[:2])[0] != 0x5A4D:
        return None
    e_lfanew = struct.unpack("<I", dos[0x3C:0x40])[0]
    nt = ctypes.string_at(base + e_lfanew, 264)
    opt_off = 4 + 20
    is64 = struct.unpack("<H", nt[opt_off:opt_off + 2])[0] == 0x20B
    dd_off = opt_off + (112 if is64 else 96)
    imp_rva, _ = struct.unpack("<II", nt[dd_off + 8:dd_off + 16])
    if not imp_rva:
        return None
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
                        return base + ft + i * ts
                i += 1
        rva += 20
    return None


def write_ptr(addr, value):
    old = wt.DWORD(0)
    k32.VirtualProtect(ctypes.c_void_p(addr), 8, 4, ctypes.byref(old))
    ctypes.c_ulonglong.from_address(addr).value = value
    k32.VirtualProtect(ctypes.c_void_p(addr), 8, old.value, ctypes.byref(old))


def main():
    print("=== загрузка DLL ===")
    dll = ctypes.WinDLL(DLL_PATH)
    base = dll._handle
    print(f"  база 0x{base:X}")

    print("\n=== патчим SetupAPI ===")
    slots = {}
    for fn, hook in (
        ("SetupDiGetClassDevsW", h_gd),
        ("SetupDiEnumDeviceInterfaces", h_ei),
        ("SetupDiGetDeviceInterfaceDetailW", h_dd),
    ):
        slot = patch_iat(base, "SETUPAPI", fn, 0)
        if slot:
            orig = ctypes.c_ulonglong.from_address(slot).value
            write_ptr(slot, ctypes.cast(hook, ctypes.c_void_p).value)
            slots[fn] = (slot, orig)
            print(f"  {fn}: патч OK (orig=0x{orig:X})")
        else:
            print(f"  {fn}: НЕ найден")

    print("\n=== вызов EnumerateDevices ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  -> 0x{rc & 0xFFFFFFFF:08X}")

    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  GetDeviceCount -> 0x{rc & 0xFFFFFFFF:08X}, count={cnt.value}")

    print(f"\n=== событий: {len(EVENTS)} ===")
    for ev in EVENTS:
        print(" ", ev)

    # восстанавливаем IAT, чтобы не оставлять процесс в кривом виде
    for fn, (slot, orig) in slots.items():
        write_ptr(slot, orig)
    print("\nIAT восстановлен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
