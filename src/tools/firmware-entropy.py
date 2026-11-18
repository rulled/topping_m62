r"""ЭНТРОПИЯ И СТРУКТУРА ПРОШИВКИ M62 — перед Ghidra.

═══════════ ЗАЧЕМ ═══════════

Прежде чем грузить образ в дизассемблер, надо понять, что там
вообще лежит: код, сжатые данные, шифротекст или контейнер.

Признаки:
  • энтропия ~8.0 на большом участке  -> шифровано или сжато;
  • энтропия 5.5..7.0                 -> код;
  • длинные ряды нулей                -> таблицы/выравнивание.

Запуск: python src/tools/firmware-entropy.py
"""

from __future__ import annotations

import math
import struct
import sys
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")


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


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()
    print("=" * 72)
    print("ПРОШИВКА M62: ЭНТРОПИЯ И СТРУКТУРА")
    print("=" * 72)
    print(f"\nфайл: {FW.name}")
    print(f"размер: {len(d)} байт (0x{len(d):x})")

    # ─── общая энтропия ───
    print(f"\nэнтропия целиком: {entropy(d):.3f} бит/байт")

    # ─── по блокам 4 КБ ───
    BLOCK = 4096
    scores = []
    for off in range(0, len(d), BLOCK):
        chunk = d[off : off + BLOCK]
        scores.append((off, entropy(chunk)))

    print("\n" + "-" * 72)
    print("КАРТА ЭНТРОПИИ (блоки 4 КБ)")
    print("-" * 72)
    print("  смещение    энтропия  полоса")
    print("  " + "-" * 66)

    # Печатаем только смены характера, чтобы не залить вывод
    prev_band = None
    for off, h in scores:
        band = "шифр/сжато" if h > 7.5 else ("код" if h > 5.0 else "данные/нули")
        if band != prev_band:
            print(f"  0x{off:06x}    {h:5.2f}     {band}  <- смена характера")
            prev_band = band

    # ─── статистика по полосам ───
    hi = sum(1 for _, h in scores if h > 7.5)
    mid = sum(1 for _, h in scores if 5.0 < h <= 7.5)
    lo = sum(1 for _, h in scores if h <= 5.0)
    print(f"\n  блоков всего: {len(scores)}")
    print(f"    >7.5 (шифр/сжато):  {hi}  ({hi * BLOCK / len(d) * 100:.1f}%)")
    print(f"    5.0..7.5 (код):     {mid}  ({mid * BLOCK / len(d) * 100:.1f}%)")
    print(f"    <=5.0 (данные):     {lo}  ({lo * BLOCK / len(d) * 100:.1f}%)")

    # ─── ряды нулей ───
    print("\n" + "-" * 72)
    print("РЯДЫ НУЛЕЙ (>=256 байт)")
    print("-" * 72)
    runs = []
    i = 0
    n = len(d)
    while i < n:
        if d[i] == 0:
            j = i
            while j < n and d[j] == 0:
                j += 1
            if j - i >= 256:
                runs.append((i, j - i))
            i = j
        else:
            i += 1
    if runs:
        for off, ln in runs:
            print(f"  0x{off:06x}  длина {ln} (0x{ln:x})")
    else:
        print("  нет")

    # ─── исполняемые подписи ───
    print("\n" + "-" * 72)
    print("ПОИСК ПОДПИСЕЙ КОДА")
    print("-" * 72)
    sigs = {
        "ARM Thumb (push {..} = b5xx)": None,
        "x86 (искали раньше)": None,
        "XMOS xcore": None,
        "gzip": b"\x1f\x8b",
        "zlib": b"\x78\x9c",
        "ELF": b"\x7fELF",
    }
    for name, pat in sigs.items():
        if pat is None:
            continue
        idx = d.find(pat)
        print(f"  {name:34} {'найден @ 0x%x' % idx if idx >= 0 else 'нет'}")

    # ─── вывод ───
    print("\n" + "=" * 72)
    print("ВЫВОД")
    print("=" * 72)
    if hi > len(scores) * 0.5:
        print("""
  Больше половины образа — высокоэнтропийные блоки.
  Это значит: внутри НЕ читаемый напрямую код, а сжатый или
  зашифрованный образ. Дизассемблер покажет мусор.

  Прежде чем идти в Ghidra, надо найти контейнер/распаковщик.
""")
    elif mid > 0:
        print(f"""
  Есть блоки с энтропией кода ({mid} блоков). Их можно грузить
  в дизассемблер, но сначала надо понять архитектуру.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
