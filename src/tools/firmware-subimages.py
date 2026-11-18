r"""ЧЕТЫРЕ ПОДОБРАЗА В ПРОШИВКЕ M62 — что у них в заголовках.

═══════════ ЧТО НАЙДЕНО ═══════════

`firmware-copies.py` показал: блоки по 512 байт повторяются на
смещениях

    0x000200,  0x027200,  0x08f200,  0x0fc200

с шагами 0x27000, 0x68000, 0x6d000. То есть в файле не одна
прошивка, а НЕСКОЛЬКО образов с одинаковой структурой заголовка.

Это важно: 1216512 байт — размер контейнера, а не прошивки.

═══════════ ЧТО ДЕЛАЕТ ═══════════

Для каждого образа печатает первые 64 байта и пытается опознать
формат по полям заголовка.

Запуск: python src/tools/firmware-subimages.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

# Начала образов, найденные по повторам (минус 0x200: заголовок
# стоит там, где начинается образ)
BASES = [0x000000, 0x027000, 0x08f000, 0x0fc000]


def describe_header(d: bytes, base: int) -> None:
    """Разобрать заголовок образа."""
    hdr = d[base : base + 64]
    print(f"\n{'=' * 70}")
    print(f"ОБРАЗ @ 0x{base:06x}")
    print("=" * 70)
    print(f"  первые 32 байта: {hdr[:32].hex()}")
    print(f"  как u32 LE:      {[hex(x) for x in struct.unpack('<8I', hdr[:32])]}")

    # Пробуем прочитать поля, которые видели в начале файла:
    #   0x00: 11 af 7a c0   -> 0xc07aaf11
    #   0x04: ad 4c 0c 98
    #   0x08: 13 6c f1 04   -> размер? 0x04f16c13
    #   0x0c: 04 00 00 00   -> 4
    u32 = struct.unpack("<16I", hdr)

    print("\n  гипотеза о полях:")
    print(f"    +0x00 u32 = 0x{u32[0]:08x}")
    print(f"    +0x04 u32 = 0x{u32[1]:08x}")
    print(f"    +0x08 u32 = 0x{u32[2]:08x}  ({u32[2]} = {u32[2] / 1024:.0f} КБ)")
    print(f"    +0x0c u32 = 0x{u32[3]:08x}  ({u32[3]})")

    # Проверяем: лежит ли по +0x08 размер, совпадающий с шагом
    candidate_size = u32[2]
    print(f"\n    если +0x08 — размер образа, то конец = 0x{base + candidate_size:06x}")

    # Печатаем подозрительно-похожие на указатели значения
    print("\n  значения, похожие на адреса/размеры:")
    for i, v in enumerate(u32):
        if 0x1000 <= v <= 0x200000 or (v >> 24) in (0x00, 0x04, 0x08, 0x20, 0x40):
            print(f"    +0x{i * 4:02x} = 0x{v:08x}")


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()
    print("=" * 70)
    print("ПОДОБРАЗЫ В ПРОШИВКЕ M62")
    print("=" * 70)
    print(f"\nфайл: {len(d)} байт (0x{len(d):x})")
    print(f"образов по повторам: {len(BASES)}")

    # Проверяем, что начала действительно похожи
    print("\n" + "-" * 70)
    print("СОВПАДЕНИЕ ЗАГОЛОВКОВ")
    print("-" * 70)
    ref = d[BASES[0] : BASES[0] + 32]
    for b in BASES:
        cur = d[b : b + 32]
        same = sum(1 for x, y in zip(ref, cur) if x == y)
        print(f"  0x{b:06x}: {same}/32 байт совпадает с первым")

    for b in BASES:
        describe_header(d, b)

    # ─── размеры ───
    print("\n" + "=" * 70)
    print("РАЗМЕРЫ И ШАГИ")
    print("=" * 70)
    for i, b in enumerate(BASES):
        nxt = BASES[i + 1] if i + 1 < len(BASES) else len(d)
        print(f"  0x{b:06x} .. 0x{nxt:06x}  = {nxt - b} байт (0x{nxt - b:x})")

    print("""
ВЫВОД

Если заголовки совпадают по структуре, а размеры разные — это
несколько независимых образов в одном контейнере (например,
прошивки разных чипов карты или основной образ + ресурсы).

Тогда для дизассемблера надо брать ОДИН образ, а не весь файл.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
