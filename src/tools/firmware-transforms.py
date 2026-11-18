r"""ТРАНСФОРМАЦИИ ОБРАЗА: может, он сохранён с свопом?

═══════════ ПОЧЕМУ ЭТО ВАЖНО ═══════════

Декодеры не нашли архитектуру: ни одна не дала больше 0.3%
покрытия. При этом:
  • энтропия 90% блоков в полосе 5.0-7.5 (не 7.9+, как у сжатого);
  • строк почти нет (0.49%).

Такая картина бывает, когда код есть, но лежит НЕ в том порядке
байт. xCORE — 16-битная машина: инструкции 16 или 32 бита, и
прошивки xCORE часто хранят в образе со свопом половин слов.

═══════════ ЧТО ПРОВЕРЯЕТСЯ ═══════════

Каждое преобразование прогоняется через декодер xCORE и ARM Thumb:
  1. как есть;
  2. своп 16-битных половин (0x1234 -> 0x3412);
  3. своп 32-битных слов (0x12345678 -> 0x78563412);
  4. инверсия бит в байте;
  5. реверс байт в каждом 32-битном слове.

Правильное преобразование даст резкий скачок покрытия.

Запуск: python src/tools/firmware-transforms.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import capstone

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

# Берём участок, где нет нулей: с 0x2000 по 0x12000
START = 0x2000
LEN = 0x10000


def swap16(d: bytes) -> bytes:
    b = bytearray(d)
    for i in range(0, len(b) - 1, 2):
        b[i], b[i + 1] = b[i + 1], b[i]
    return bytes(b)


def swap32(d: bytes) -> bytes:
    b = bytearray(d)
    for i in range(0, len(b) - 3, 4):
        b[i], b[i + 1], b[i + 2], b[i + 3] = (
            b[i + 3], b[i + 2], b[i + 1], b[i],
        )
    return bytes(b)


def reverse_in_word32(d: bytes) -> bytes:
    """Реверс байт внутри 32-битного слова."""
    b = bytearray(d)
    for i in range(0, len(b) - 3, 4):
        b[i], b[i + 1], b[i + 2], b[i + 3] = (
            b[i + 3], b[i + 2], b[i + 1], b[i],
        )
    return bytes(b)


def invert_bits(d: bytes) -> bytes:
    return bytes(x ^ 0xFF for x in d)


def coverage(data: bytes, arch, mode, limit: int = 20000) -> float:
    """Доля декодированных байт."""
    try:
        md = capstone.Cs(arch, mode)
        md.detail = False
        total = 0
        covered = 0
        for ins in md.disasm(data, 0x1000):
            total += 1
            covered += ins.size
            if total > limit:
                break
        return covered / max(1, len(data))
    except Exception:  # noqa: BLE001
        return -1.0


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()
    sample = d[START : START + LEN]

    transforms = [
        ("как есть", sample),
        ("своп 16 бит", swap16(sample)),
        ("своп 32 бита", swap32(sample)),
        ("инверсия бит", invert_bits(sample)),
        ("реверс байт в слове", reverse_in_word32(sample)),
    ]

    decoders = [
        ("XCORE LE", capstone.CS_ARCH_XCORE, capstone.CS_MODE_LITTLE_ENDIAN),
        ("XCORE BE", capstone.CS_ARCH_XCORE, capstone.CS_MODE_BIG_ENDIAN),
        ("ARM Thumb LE", capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB),
        ("x86-32", capstone.CS_ARCH_X86, capstone.CS_MODE_32),
    ]

    print("=" * 76)
    print("ТРАНСФОРМАЦИИ ОБРАЗА M62")
    print("=" * 76)
    print(f"\nучасток 0x{START:x}..0x{START + LEN:x} ({LEN} байт)\n")

    print("-" * 76)
    print("ПОКРЫТИЕ ДЕКОДЕРАМИ (доля байт)")
    print("-" * 76)
    header = f"  {'преобразование':22}" + "".join(
        f"{name:14}" for name, _, _ in decoders
    )
    print(header)
    print("  " + "-" * 70)

    best = (None, None, 0.0)
    for tname, tdata in transforms:
        row = f"  {tname:22}"
        for dname, arch, mode in decoders:
            cov = coverage(tdata, arch, mode)
            row += f"{cov * 100:12.2f}%  "
            if cov > best[2]:
                best = (tname, dname, cov)
        print(row)

    # ─── вывод ───
    print("\n" + "=" * 76)
    print("ВЫВОД")
    print("=" * 76)

    if best[2] > 0.6:
        print(f"""
  ПРОРЫВ: преобразование «{best[0]}» + декодер «{best[1]}»
  даёт {best[2] * 100:.1f}% покрытия.

  Значит образ сохранён со свопом, и перед дизассемблированием его
  надо преобразовать. Дальше можно грузить в Ghidra.
""")
    else:
        print(f"""
  Ни одно простое преобразование не помогло (лучшее
  {best[2] * 100:.1f}%: {best[0]} / {best[1]}).

  Значит дело не в порядке байт. Остаются варианты:
    1. образ зашифрован — тогда нужен ключ из загрузчика/DFU;
    2. это не образ кода, а контейнер с блоками (заголовки видны:
       магия 0xc07aaf11 в 4 местах);
    3. код сжат особым образом (не gzip/zlib — их сигнатур нет).

  Вывод для Ghidra: грузить напрямую БЕСПОЛЕЗНО — она покажет мусор.
  Надо сначала понять формат контейнера 0xc07aaf11.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
