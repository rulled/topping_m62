"""
Решающий тест: инициализация контекста через последовательность IOCTL.

ЧТО ИЗВЕСТНО:
  - DLL находит интерфейс по GUID из custom.ini (перехвачено);
  - GetDeviceCount = 0 -> список устройств пуст, значит контекст не поднят;
  - OpenDeviceByIndex -> 0xEE000070 («нет списка»);
  - прямой GetDspProperty -> 0xEE000048.

ГИПОТЕЗА: контекст поднимается НЕ через SetupAPI-интерфейс, а через
открытие другого device path. DLL сначала открывает устройство,
потом шлёт IOCTL-инициализацию, и только затем появляется таблица
свойств.

ПРОВЕРЯЕМ: перехватываем DeviceIoControl у DLL и смотрим, какие IOCTL
она шлёт ПРИКЛАДНО при первом обращении — их последовательность и есть
протокол инициализации.

БЕЗОПАСНОСТЬ: DLL вызывается только для чтения (Enumerate/GetDsp).
Записывающие функции не вызываются. Логируем, ничего не подменяем
по значению.

Запуск: python research/dis/trace_ioctl.py
"""

import ctypes
import ctypes.wintypes as wt
import json
import struct
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

TRACE = []
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

_DeviceIoControl = kernel32.DeviceIoControl
PROTO = ctypes.WINFUNCTYPE(
    wt.BOOL, ctypes.c_void_p, wt.DWORD, ctypes.c_void_p, wt.DWORD,
    ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p,
)


@PROTO
def hook(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov):
    inhex = None
    if inbuf and 0 < insize <= 256:
        try:
            inhex = ctypes.string_at(inbuf, insize).hex()
        except Exception:
            pass
    ok = _DeviceIoControl(h, ioctl, inbuf, insize, outbuf, outsize, ret, ov)
    err = ctypes.get_last_error()
    outhex = None
    if ok and outbuf and outsize:
        try:
            outhex = ctypes.string_at(outbuf, min(outsize, 64)).hex()
        except Exception:
            pass
    TRACE.append({
        "ioctl": f"0x{ioctl:08X}",
        "inSize": insize,
        "in": inhex,
        "ok": bool(ok),
        "err": f"0x{err & 0xFFFFFFFF:08X}",
        "out": outhex,
    })
    return ok


def patch_iat(base, dll_name, func_name, new_addr):
    dos = ctypes.string_at(base, 64)
    if struct.unpack("<H", dos[:2])[0] != 0x5A4D:
        return False
    e_lfanew = struct.unpack("<I", dos[0x3C:0x40])[0]
    nt = ctypes.string_at(base + e_lfanew, 264)
    opt_off = 4 + 20
    magic = struct.unpack("<H", nt[opt_off:opt_off + 2])[0]
    is64 = magic == 0x20B
    dd_off = opt_off + (112 if is64 else 96)
    imp_rva, _ = struct.unpack("<II", nt[dd_off + 8:dd_off + 16])
    if not imp_rva:
        return False
    rva = imp_rva
    thunk_size = 8 if is64 else 4
    while True:
        desc = ctypes.string_at(base + rva, 20)
        oft, ts, fc, name_rva, ft = struct.unpack("<IIIII", desc)
        if name_rva == 0:
            break
        mod = ctypes.string_at(base + name_rva).decode("ascii", "replace")
        if dll_name.lower() in mod.lower():
            t = oft if oft else ft
            i = 0
            while True:
                val = struct.unpack(
                    "<Q" if is64 else "<I",
                    ctypes.string_at(base + t + i * thunk_size, thunk_size)
                )[0]
                if val == 0:
                    break
                if not (val & (1 << (63 if is64 else 31))):
                    fn = ctypes.string_at(base + val + 2).split(b"\x00", 1)[0].decode(
                        "ascii", "replace"
                    )
                    if fn == func_name:
                        addr = base + ft + i * thunk_size
                        op = wt.DWORD(0)
                        kernel32.VirtualProtect(
                            ctypes.c_void_p(addr), thunk_size, 0x04, ctypes.byref(op)
                        )
                        ctypes.c_ulonglong.from_address(addr).value = new_addr
                        kernel32.VirtualProtect(
                            ctypes.c_void_p(addr), thunk_size, op.value, ctypes.byref(op)
                        )
                        return True
                i += 1
        rva += 20
    return False


def main():
    dll = ctypes.WinDLL(DLL_PATH)
    base = dll._handle
    addr = ctypes.cast(hook, ctypes.c_void_p).value
    ok = patch_iat(base, "KERNEL32", "DeviceIoControl", addr)
    print(f"перехват DeviceIoControl: {'OK' if ok else 'НЕ УДАЛСЯ'}")

    print("\n=== EnumerateDevices ===")
    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"  -> 0x{rc & 0xFFFFFFFF:08X}")

    print("\n=== GetDeviceCount ===")
    dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
    cnt = ctypes.c_uint32(0)
    rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
    print(f"  -> 0x{rc & 0xFFFFFFFF:08X}, count={cnt.value}")

    print(f"\n=== IOCTL-трасса: {len(TRACE)} ===")
    for t in TRACE:
        print(json.dumps(t, ensure_ascii=False))

    if not TRACE:
        print("  НИ ОДНОГО DeviceIoControl не вызвано")
        print("  -> значит DLL вообще не дошла до драйвера:")
        print("     список устройств пуст на уровне SetupAPI/KS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
