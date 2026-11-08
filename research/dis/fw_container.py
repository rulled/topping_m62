"""
Разбор КОНТЕЙНЕРА прошивки M62.

Устройство содержит STM32G070R (Cortex-M0+), но raw ARM-кода в файле нет
и векторной таблицы нет. Значит .bin — это КОНТЕЙНЕР, внутри которого
лежат упакованные образы либо для нескольких чипов.

Из наблюдений:
  +0x00  C07AAF11  980C4CAD  04F16C13  00000004   <- магия/заголовок
  +0x10  0020568E  00000010  0020568E  00000020   <- повторяющаяся пара
  +0x2C  00000083  00000004  50F02010  00000008
  +0x3C  000070AC
  +0x40  0000F18A  08200020  00005797
  +0x60  00105FC8  08300020  0000C171

Пары (offset, length) вида 0x0020568E/0x00105FC8 похожи на ссылки на
внутренние структуры (в 24-битном диапазоне = 2 МБ, что больше файла).

Проверяем: ищем структуры-описатели блоков, проверяем на наличие
сигнатур (zlib, LZMA, LZ4, ARM vector table, STM32) по всему файлу.

Только чтение.
"""

import struct
import sys
import zlib
from collections import Counter

BIN = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"

SIGNATURES = {
    "zlib (78 9C)": b"\x78\x9c",
    "zlib (78 01)": b"\x78\x01",
    "zlib (78 DA)": b"\x78\xda",
    "gzip": b"\x1f\x8b",
    "LZMA": b"\x5d\x00\x00",
    "xz": b"\xfd7zXZ\x00",
    "LZ4": b"\x04\x22\x4d\x18",
    "Zstd": b"\x28\xb5\x2f\xfd",
    "ARM vector (SP 0x2000)": struct.pack("<I", 0x20005000),
    "STM32 ROM": b"\x00\x00\x02\x08",
}


def entropy(chunk):
    if not chunk:
        return 0.0
    f = Counter(chunk)
    n = len(chunk)
    e = 0.0
    for c in f.values():
        p = c / n
        e -= p * (p.bit_length() and __import__("math").log2(p))
    return e


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    print(f"размер: {len(data)} (0x{len(data):X})")

    import math

    def ent(chunk):
        if not chunk:
            return 0.0
        f = Counter(chunk)
        n = len(chunk)
        return -sum((c / n) * math.log2(c / n) for c in f.values())

    # --- сигнатуры ---
    print("\n=== поиск сигнатур сжатия/кода ===")
    for name, sig in SIGNATURES.items():
        idx = []
        off = 0
        while True:
            i = data.find(sig, off)
            if i < 0:
                break
            idx.append(i)
            off = i + 1
            if len(idx) > 8:
                break
        if idx:
            print(f"  {name:<26} {len(idx)}+ вхождений, первые: "
                  + ", ".join(f"0x{i:X}" for i in idx[:5]))

    # --- профиль энтропии ---
    print("\n=== профиль энтропии (блоки 64 КБ) ===")
    B = 0x10000
    for off in range(0, len(data), B):
        chunk = data[off:off + B]
        e = ent(chunk)
        bar = "#" * int(e * 10)
        kind = "СЖАТО/ШИФР" if e > 7.5 else ("код" if e > 5.0 else "данные")
        print(f"  0x{off:06X}  {e:5.2f}  {bar:<30} {kind}")

    # --- заголовок как структура ---
    print("\n=== первый килобайт как dword ===")
    for i in range(0, 0x100, 4):
        v = struct.unpack_from("<I", data, i)[0]
        print(f"  +0x{i:03X}  {v:10d}  0x{v:08X}")

    # --- пробуем zlib в известных точках ---
    print("\n=== попытки распаковки zlib ===")
    for off in range(0, min(len(data), 0x200000)):
        if data[off] == 0x78 and data[off + 1] in (0x01, 0x9C, 0xDA):
            try:
                out = zlib.decompressobj().decompress(data[off:off + 65536])
                if len(out) > 1024:
                    print(f"  +0x{off:X}: распаковалось {len(out)} байт")
            except zlib.error:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
