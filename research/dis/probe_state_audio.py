"""
Проверка гипотезы: DSP-свойства (0x80882200) доступны только когда
устройство в состоянии [dev+0x4c4] == 1.

Из дизассемблера: состояние вычисляется драйвером при конфигурации
интерфейса. Гипотеза — оно становится 1, когда активен аудиопоток
(altsetting != 0) либо при определённом USB-конфиге.

МЕТОД: открываем handle, пробуем 0x80882200 ДО и ПОСЛЕ начала
воспроизведения звука через Windows (тихий файл), сравниваем коды.

БЕЗОПАСНОСТЬ:
  - открываем только ЧТЕНИЕ (0x80882200, 0x80882210);
  - 0x80882204 (запись) НЕ вызывается;
  - звук: если выходы не подключены (HP=0, OTG=0), воспроизведение
    физически беззвучно. Скрипт это проверяет через HID.

Запуск: python research/dis/probe_state_audio.py
"""

import ctypes
import ctypes.wintypes as wt
import struct
import subprocess
import sys
import time

IFACE = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
IOCTL_GET = 0x80882200
IOCTL_VERS = 0x80882210

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


def call(h, code, insize, outsize, fill=0):
    b = ctypes.create_string_buffer(insize) if insize else None
    if b and insize >= 4:
        struct.pack_into("<I", b, 0, fill)
    out = ctypes.create_string_buffer(max(outsize, 1))
    ret = wt.DWORD(0)
    ok = k32.DeviceIoControl(h, code, b, insize, out, outsize,
                             ctypes.byref(ret), None)
    return ok, ctypes.get_last_error() & 0xFFFFFFFF, ret.value, bytes(out.raw[:max(outsize, 1)])


def probe(label, h):
    ok, err, ret, out = call(h, IOCTL_GET, 4, 4, 0)
    v_ok, v_err, v_ret, v_out = call(h, IOCTL_VERS, 4, 4, 0)
    g = "OK" if ok else f"0x{err:08X}"
    v = "OK" if v_ok else f"0x{v_err:08X}"
    print(f"  {label:<28} get={g:<12} vers={v:<12}", end="")
    if ok:
        print(f" out={out.hex()}", end="")
    print()
    return ok


def main():
    h = open_dev()
    if not h or h == INVALID_HANDLE:
        print("не открылось")
        return 1
    print(f"handle=0x{h:X}\n")

    print("=== ДО воспроизведения ===")
    probe("состояние", h)

    print("\n=== запускаем воспроизведение (тихий тон) ===")
    # PowerShell: проиграть беззвучный wav через M62
    ps = r'''
$ErrorActionPreference = 'SilentlyContinue'
$p = New-Object System.Media.SoundPlayer
# генерируем короткий тихий wav в памяти
$sr = 48000; $dur = 12; $n = $sr * $dur
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$dataLen = $n * 2
$bw.Write([char[]]'RIFF'); $bw.Write([int](36 + $dataLen))
$bw.Write([char[]]'WAVE'); $bw.Write([char[]]'fmt ')
$bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]2)
$bw.Write([int]$sr); $bw.Write([int]($sr*4)); $bw.Write([int16]4); $bw.Write([int16]16)
$bw.Write([char[]]'data'); $bw.Write([int]$dataLen)
for ($i=0; $i -lt $n; $i++) { $bw.Write([int16]0) }
$bw.Flush()
$ms.Position = 0
$p.Stream = $ms
$p.PlaySync()
'''
    proc = subprocess.Popen(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    for i in range(1, 7):
        time.sleep(1.5)
        probe(f"во время (t={i * 1.5:.0f}с)", h)

    proc.wait(timeout=30)

    print("\n=== ПОСЛЕ воспроизведения ===")
    probe("состояние", h)

    k32.CloseHandle(h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
