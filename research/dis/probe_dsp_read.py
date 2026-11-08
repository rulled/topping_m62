"""
ПРАВИЛЬНАЯ сигнатура DSP-свойств (из дизассемблера обёрток).

  0x180001DA0 TUSBAUDIO_GetDspProperty:
      mov r9d, r8d        ; r9  = arg3 = size
      mov r8,  rdx        ; r8  = arg2 = buf
      mov edx, ecx        ; edx = arg1 = propId
      lea rcx, [rip+...]  ; rcx = ВНУТРЕННИЙ контекст (задаётся OpenDeviceByIndex)
      jmp 0x18000E0A0

  => GetDspProperty(uint32 propId, void *buf, uint32 size)   // 3 аргумента!

  То же для SetDspProperty(propId, buf, size).

Раньше я ошибочно передавал handle первым — отсюда 0xEE000041
("нулевой аргумент") и 0x3E6 (ERROR_NOACCESS).

БЕЗОПАСНОСТЬ: только чтение (GetDspProperty). SetDspProperty не трогаем.

Запуск: python research/dis/probe_dsp_read.py
"""

import ctypes
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

HINTS = {
    0xEE000032: "неверное состояние",
    0xEE000033: "устройство не открыто",
    0xEE000041: "нулевой аргумент",
    0xEE000048: "неверный параметр",
    0x000003E6: "ERROR_NOACCESS (плохой указатель)",
    0x00000001: "общий сбой",
}


def u32(v):
    return v & 0xFFFFFFFF


def explain(rc):
    rc = u32(rc)
    if rc == 0:
        return "OK"
    return f"0x{rc:08X}" + (f" — {HINTS[rc]}" if rc in HINTS else "")


def main():
    dll = ctypes.WinDLL(DLL_PATH)

    dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
    dll.TUSBAUDIO_EnumerateDevices.argtypes = []
    rc = dll.TUSBAUDIO_EnumerateDevices()
    print(f"EnumerateDevices -> {explain(rc)}")

    # открытие задаёт внутренний контекст
    dll.TUSBAUDIO_OpenDeviceByIndex.restype = ctypes.c_uint32
    dll.TUSBAUDIO_OpenDeviceByIndex.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    handle = ctypes.c_void_p(0)
    rc = dll.TUSBAUDIO_OpenDeviceByIndex(0, ctypes.byref(handle))
    print(f"OpenDeviceByIndex(0) -> {explain(rc)} handle=0x{handle.value or 0:X}")
    if u32(rc) != 0:
        print("не открылось — дальше бессмысленно")
        return 1

    # --- ПРАВИЛЬНАЯ сигнатура: (propId, buf, size) ---
    dll.TUSBAUDIO_GetDspProperty.restype = ctypes.c_uint32
    dll.TUSBAUDIO_GetDspProperty.argtypes = [
        ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
    ]

    print("\n=== чтение DSP-свойств (propId, buf, size) ===")
    ok_ids = []
    for prop in range(0, 64):
        buf = ctypes.create_string_buffer(256)
        rc = dll.TUSBAUDIO_GetDspProperty(prop, buf, 256)
        if u32(rc) == 0:
            data = buf.raw[:16]
            val = int.from_bytes(data[:4], "little")
            print(f"  prop={prop:>3} (0x{prop:02X})  OK   first4={val:>10}   hex={data.hex()}")
            ok_ids.append(prop)
        elif u32(rc) not in (0xEE000048,):
            print(f"  prop={prop:>3}  {explain(rc)}")

    print(f"\nчитаемых свойств найдено: {len(ok_ids)}")

    # --- расширенный диапазон, если мало ---
    if len(ok_ids) < 5:
        print("\n=== расширенный поиск (0x0..0x200, шаг 1) ===")
        for prop in range(64, 0x200):
            buf = ctypes.create_string_buffer(256)
            rc = dll.TUSBAUDIO_GetDspProperty(prop, buf, 256)
            if u32(rc) == 0:
                data = buf.raw[:16]
                val = int.from_bytes(data[:4], "little")
                print(f"  prop=0x{prop:03X}  OK  {val:>10}  hex={data.hex()}")
                ok_ids.append(prop)

    dll.TUSBAUDIO_CloseDevice.restype = ctypes.c_uint32
    dll.TUSBAUDIO_CloseDevice.argtypes = [ctypes.c_void_p]
    rc = dll.TUSBAUDIO_CloseDevice(handle)
    print(f"\nCloseDevice -> {explain(rc)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
