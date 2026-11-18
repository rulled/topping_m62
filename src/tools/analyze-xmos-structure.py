r"""ГЛУБОКОЕ СРАВНЕНИЕ: наш образ M62 против эталона XU316.

═══════════ ЧТО ВЫЯСНИЛОСЬ ═══════════

Магия `0xc07aaf11` встречается В ОБОИХ образах:
  • эталон XU316 (собран штатным xflash): 3 вхождения
  • наш M62:                                8 вхождений

Плотность почти одинаковая (0.001% против 0.0007%). Значит это
НЕ магия контейнера Topping, а частое значение в коде XMOS.
Возможно, это просто инструкция xCORE или константа.

═══════════ ЧТО НАДО ПОНЯТЬ ═══════════

1. Где в эталоне начинается код (после какого заголовка)?
2. Есть ли в нашем образе такая же структура?
3. Можно ли найти в нашем образе XMOS boot loader?

Эталон собран `xflash --factory`, и его формат документирован.
Если наш образ имеет ту же структуру — его можно разобрать
штатными средствами XMOS (xobjdump).

Запуск: python src/tools/analyze-xmos-structure.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

OURS = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")
REF = Path("research/xmos-samples/xu316-factory.bin")


def words(d: bytes, off: int, n: int) -> list:
    return [struct.unpack_from("<I", d, off + i * 4)[0] for i in range(n)]


def look_for_bootloader(d: bytes) -> list:
    """Искать признаки XMOS boot loader.

    По документации XMOS, во флеш-образе лежит:
      • Boot Partition Header
      • XTC Boot Loader (начинается с размера)
      • приложение
    Бут-лоадер обычно содержит много коротких инструкций и вызовов.
    """
    # Ищем последовательности, характерные для начала загрузчика:
    # в эталоне первое слово 0x000050a9 (20649) — похоже на размер
    hits = []
    for off in range(0, len(d) - 4, 4):
        w = struct.unpack_from("<I", d, off)[0]
        # размер бут-лоадера обычно 1-64 КБ и кратен 4
        if 0x100 <= w <= 0x10000 and w % 4 == 0:
            nxt = struct.unpack_from("<I", d, off + 4)[0]
            # следующее слово — версия/флаги, обычно небольшое
            if nxt <= 0x1000:
                hits.append((off, w, nxt))
    return hits


def compare_headers() -> None:
    ref = REF.read_bytes()
    ours = OURS.read_bytes()

    print("=" * 76)
    print("СТРУКТУРА ОБРАЗОВ")
    print("=" * 76)

    print(f"\nЭТАЛОН XU316 ({len(ref)} байт):")
    print(f"  первое слово:  0x{words(ref, 0, 1)[0]:08x}")
    print(f"  первые 16 u32: {[hex(x) for x in words(ref, 0, 16)]}")

    print(f"\nНАШ M62 ({len(ours)} байт):")
    print(f"  первое слово:  0x{words(ours, 0, 1)[0]:08x}")
    print(f"  первые 16 u32: {[hex(x) for x in words(ours, 0, 16)]}")

    # ─── размер эталона vs заявленный ───
    print("\n" + "-" * 76)
    print("РАЗМЕРЫ: заявленные в заголовке vs фактические")
    print("-" * 76)

    # В эталоне +0x00 = 0x50a9 = 20649. Файл 286720.
    # +0x08 = 0x400600 = 4195840 — это размер флеша (4 МБ!)
    print(f"  эталон: файл {len(ref)} (0x{len(ref):x})")
    print(f"    +0x00 = {words(ref, 0, 1)[0]} (0x{words(ref, 0, 1)[0]:x})")
    print(f"    +0x08 = {words(ref, 2, 1)[0]} (0x{words(ref, 2, 1)[0]:x}) "
          f"= {words(ref, 2, 1)[0] / 1024 / 1024:.1f} МБ")
    print(f"    +0x0c = {words(ref, 3, 1)[0]} (0x{words(ref, 3, 1)[0]:x})")
    print(f"    → 0x400600 = 4 195 840 ≈ размер флеша 4 МБ")

    print(f"\n  наш: файл {len(ours)} (0x{len(ours):x})")
    print(f"    +0x00 = 0x{words(ours, 0, 1)[0]:08x}  (магия/код)")
    print(f"    +0x08 = {words(ours, 2, 1)[0]} (0x{words(ours, 2, 1)[0]:x})"
          f" = {words(ours, 2, 1)[0] / 1024 / 1024:.1f} МБ")
    print(f"    +0x0c = {words(ours, 3, 1)[0]}")

    # ─── ищем boot loader ───
    print("\n" + "-" * 76)
    print("ПОИСК BOOT LOADER (эвристика)")
    print("-" * 76)

    for name, d in (("эталон", ref), ("наш", ours)):
        hits = look_for_bootloader(d)
        print(f"\n  {name}: кандидатов {len(hits)}")
        for off, w, nxt in hits[:6]:
            print(f"    0x{off:06x}: размер {w} (0x{w:x}), следующее {nxt}")

    # ─── сравнение распределения ───
    print("\n" + "-" * 76)
    print("СРАВНЕНИЕ: доля нулей и распределение")
    print("-" * 76)
    for name, d in (("эталон", ref), ("наш", ours)):
        zeros = d.count(0)
        print(f"  {name:8} нулей {zeros / len(d) * 100:5.1f}%, "
              f"размер {len(d)}")


def main() -> int:
    if not REF.exists() or not OURS.exists():
        print("нужны оба файла")
        return 1
    compare_headers()

    print("\n" + "=" * 76)
    print("ЧТО ЭТО ЗНАЧИТ")
    print("=" * 76)
    print("""
Магия 0xc07aaf11 есть в ОБОИХ образах. Значит это не контейнер
Topping, а обычное значение в коде XMOS (вероятно, инструкция или
частая константа).

Отсюда следует ГЛАВНОЕ: наш образ M62, скорее всего, ТОЖЕ является
XMOS-образом — просто собранным не штатным xflash, а своим способом
(например, с шифрованием/сжатием или своей раскладкой разделов).

Проверить это окончательно можно официальным дизассемблером XMOS —
xobjdump из XTC Tools. Он умеет:
  • разбирать .xe файлы;
  • дизассемблировать XS1/XS2/XS3 код.

Если xobjdump прочитает наш образ — прошивка доступна для анализа.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
