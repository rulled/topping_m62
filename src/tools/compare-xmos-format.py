r"""СРАВНЕНИЕ ФОРМАТА: наш образ M62 против эталонного XU316.

═══════════ ЗАЧЕМ ═══════════

Из issue Ghidra #5835 и документации XMOS известно:
  • XU316 = XS3-архитектура;
  • xobjdump умеет дизассемблировать .xe;
  • xflash создаёт образ флеша в формате XTC.

Есть эталон: `ffva_v1.3.1_factory.bin` (286 720 байт) — настоящий
образ XU316, собранный xflash. Он ПУБЛИЧНЫЙ и получен из открытого
проекта.

Если наш образ M62 использует тот же формат, заголовок должен
совпасть по структуре. Если нет — мы это увидим и поймём, что
контейнер свой.

═══════════ ЧТО СРАВНИВАЕМ ═══════════

1. Первые 64 байта обоих образов (hex).
2. Магию `0xc07aaf11`.
3. Энтропию и распределение.
4. Наличие формата XMOS.

Запуск: python src/tools/compare-xmos-format.py
"""

from __future__ import annotations

import math
import struct
import sys
from pathlib import Path

OURS = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")
REF = Path("research/xmos-samples/xu316-factory.bin")


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    h = 0.0
    for c in counts:
        if c:
            p = c / n
            h -= p * math.log2(p)
    return h


def describe(name: str, path: Path) -> None:
    if not path.exists():
        print(f"\n{name}: файла нет ({path})")
        return
    d = path.read_bytes()
    print(f"\n{'=' * 70}")
    print(f"{name}: {path.name}")
    print("=" * 70)
    print(f"  размер: {len(d)} байт (0x{len(d):x})")
    print(f"  энтропия: {entropy(d):.3f} бит/байт")
    print(f"\n  первые 64 байта:")
    for off in range(0, min(64, len(d)), 16):
        chunk = d[off : off + 16]
        hx = " ".join(f"{b:02x}" for b in chunk)
        txt = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        print(f"    {off:04x}  {hx:<48}  {txt}")

    print(f"\n  как u32 LE:")
    for i in range(0, min(48, len(d)), 4):
        (v,) = struct.unpack_from("<I", d, i)
        print(f"    +{i:02x}  0x{v:08x}  ({v})")

    # магия нашего контейнера
    magic = struct.pack("<I", 0xC07AAF11)
    found = []
    s = 0
    while True:
        i = d.find(magic, s)
        if i < 0:
            break
        found.append(i)
        s = i + 1
    print(f"\n  магия 0xc07aaf11: {len(found)} вхождений"
          f"{' @ ' + ', '.join(hex(x) for x in found[:8]) if found else ''}")


def main() -> int:
    print("=" * 74)
    print("ФОРМАТ ОБРАЗА: M62 против ЭТАЛОННОГО XU316")
    print("=" * 74)

    describe("ЭТАЛОН XU316 (xflash, открытый проект)", REF)
    describe("НАШ ОБРАЗ M62", OURS)

    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)

    if not REF.exists() or not OURS.exists():
        print("  нужно оба файла")
        return 1

    ref = REF.read_bytes()
    ours = OURS.read_bytes()

    ref_magic = struct.pack("<I", 0xC07AAF11)
    print(f"""
  Эталон XU316:
    • размер {len(ref)}
    • магия 0xc07aaf11: {'ЕСТЬ' if ref_magic in ref else 'НЕТ'}
    • заголовок: {ref[:16].hex()}

  Наш M62:
    • размер {len(ours)}
    • магия 0xc07aaf11: {'ЕСТЬ' if ref_magic in ours else 'НЕТ'}
    • заголовок: {ours[:16].hex()}
""")

    if ref_magic in ours and ref_magic not in ref:
        print("""
  ВАЖНО: магия нашего контейнера НЕ встречается в эталонном образе
  XU316, собранном штатным xflash.

  Значит наш файл — НЕ образ флеша XMOS в том виде, в котором его
  создаёт xflash. Это либо:
    • образ .xe (другой формат, не флеш-образ), который карта
      распаковывает сама;
    • контейнер Topping поверх образов;
    • образ с шифрованием/сжатием на уровне загрузчика.

  Однако размер 1 216 512 байт (0x129000) кратен 0x1000, что
  типично для выровненных разделов.
""")
    elif ref_magic in ref:
        print("\n  Формат совпадает по магии — можно разбирать дальше.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
