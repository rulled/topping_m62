"""
Проверка: можно ли использовать вендорскую DLL напрямую, без MCC.

ИДЕЯ: MCC — просто клиент этой DLL. Если загрузить её сами и вызвать
экспорты, получим весь функционал (микшер, EQ, эффекты) БЕЗ MCC и без
реверса формата буфера.

БЕЗОПАСНОСТЬ: на этом шаге вызываем ТОЛЬКО читающие функции:
  - CheckApiVersion / GetApiVersion
  - EnumerateDevices / GetDeviceCount
  - OpenDevice (нужен для последующих), CloseDevice
GetDspProperty/SetDspProperty не трогаем — сначала надо понять id свойств.

Запуск: python research/dis/probe_dll_api.py
"""

import ctypes
import sys

DLL_PATH = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

# Коды возврата Thesycon (из дизассемблера)
ERROR_STRINGS = {
    0xEE000032: "предыдущая операция не завершена / неверное состояние",
    0xEE000033: "устройство не открыто",
    0xEE000041: "нулевой аргумент",
    0xEE000048: "неверный параметр",
}


def u32(v):
    return v & 0xFFFFFFFF


def explain(rc):
    rc = u32(rc)
    if rc == 0:
        return "OK (0)"
    note = ERROR_STRINGS.get(rc, "")
    return f"0x{rc:08X}" + (f" — {note}" if note else "")


def main():
    print(f"=== загрузка {DLL_PATH} ===")
    try:
        dll = ctypes.WinDLL(DLL_PATH)
    except OSError as exc:
        print(f"  LoadLibrary FAILED: {exc}")
        return 1
    print("  OK")

    # --- версия API ---
    print("\n=== версия API ===")
    try:
        dll.TUSBAUDIO_GetApiVersion.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetApiVersion.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
        ver = ctypes.c_uint32(0)
        rc = dll.TUSBAUDIO_GetApiVersion(ctypes.byref(ver))
        print(f"  GetApiVersion -> {explain(rc)}, version=0x{ver.value:08X} ({ver.value})")

        dll.TUSBAUDIO_CheckApiVersion.restype = ctypes.c_uint32
        dll.TUSBAUDIO_CheckApiVersion.argtypes = [ctypes.c_uint32]
        rc2 = dll.TUSBAUDIO_CheckApiVersion(ver.value)
        print(f"  CheckApiVersion(version) -> {explain(rc2)}")
    except AttributeError as exc:
        print(f"  нет экспорта: {exc}")

    # --- число устройств ---
    print("\n=== устройства ===")
    try:
        dll.TUSBAUDIO_GetDeviceCount.restype = ctypes.c_uint32
        dll.TUSBAUDIO_GetDeviceCount.argtypes = [ctypes.POINTER(ctypes.c_uint32)]
        cnt = ctypes.c_uint32(0)
        rc = dll.TUSBAUDIO_GetDeviceCount(ctypes.byref(cnt))
        print(f"  GetDeviceCount -> {explain(rc)}, count={cnt.value}")
    except AttributeError as exc:
        print(f"  нет экспорта: {exc}")

    # --- перечисление ---
    print("\n=== EnumerateDevices ===")
    try:
        dll.TUSBAUDIO_EnumerateDevices.restype = ctypes.c_uint32
        # сигнатура неизвестна: пробуем без аргументов (типично для Thesycon)
        rc = dll.TUSBAUDIO_EnumerateDevices()
        print(f"  EnumerateDevices() -> {explain(rc)}")
    except Exception as exc:  # noqa: BLE001
        print(f"  вызов не удался: {exc}")

    # --- список экспортов для справки ---
    print("\n=== экспорты DSP/устройства ===")
    for name in (
        "TUSBAUDIO_OpenDevice", "TUSBAUDIO_CloseDevice",
        "TUSBAUDIO_GetDspProperty", "TUSBAUDIO_SetDspProperty",
        "TUSBAUDIO_GetDeviceProperties", "TUSBAUDIO_GetDeviceInstanceIdString",
        "TUSBAUDIO_GetCustomString", "TUSBAUDIO_GetChannelInfo",
    ):
        try:
            fn = getattr(dll, name)
            ok = "есть"
        except AttributeError:
            ok = "НЕТ"
        print(f"  {name:<36} {ok}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
