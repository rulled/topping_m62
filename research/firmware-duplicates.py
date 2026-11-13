r"""СТРУКТУРА ПОВТОРОВ В ПРОШИВКЕ M62.

══════════ ЧТО ЗАМЕЧЕНО ══════════

При проверке сигнатур оказалось, что куски файла ПОВТОРЯЮТСЯ
байт в байт:

    @0x05F963 == @0x0CA24B   (16 байт)
    @0x045553 == @0x0AFD7B   (16 байт)

Это не случайность: вероятность совпадения 16 байт ~ 2^-128.
Значит файл содержит одинаковые блоки — типично для таблиц
коэффициентов (одинаковые фильтры) или для нескольких образов
одного формата.

══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ══════════

1. Ищет повторяющиеся блоки по 4 КБ — так видно крупные дубликаты.
2. Определяет расстояние между дубликатами (может быть размером
   образа или записи).
3. Строит карту: какие участки уникальны, какие повторяются.
4. Ищет периодичность — если файл это массив записей фиксированной
   длины, шаг будет виден.

Запуск: python research/firmware-duplicates.py
"""

from __future__ import annotations

import hashlib
import sys
from collections import Counter, defaultdict
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")


def main() -> None:
    if not FW.exists():
        sys.exit(f"нет файла: {FW}")
    data = FW.read_bytes()
    print("=" * 74)
    print("СТРУКТУРА ПОВТОРОВ В ПРОШИВКЕ")
    print("=" * 74)
    print(f"размер: {len(data)} байт (0x{len(data):X})")

    # ─── 1. повторяющиеся блоки 4 КБ ───
    print("\n" + "-" * 74)
    print("ПОВТОРЯЮЩИЕСЯ БЛОКИ 4 КБ")
    print("-" * 74)
    BLK = 4096
    seen = defaultdict(list)
    for off in range(0, len(data) - BLK + 1, BLK):
        h = hashlib.sha256(data[off : off + BLK]).hexdigest()[:16]
        seen[h].append(off)

    dups = {h: offs for h, offs in seen.items() if len(offs) > 1}
    total_blocks = len(seen)
    print(f"  блоков всего:   {sum(len(o) for o in seen.values())}")
    print(f"  уникальных:     {total_blocks}")
    print(f"  с повторами:    {len(dups)}")

    if dups:
        print("\n  группы повторов (первые 12):")
        for h, offs in list(dups.items())[:12]:
            dists = [offs[i + 1] - offs[i] for i in range(len(offs) - 1)]
            print(f"    {h}  x{len(offs)}  @{[hex(o) for o in offs]}")
            print(f"        расстояния: {[hex(d) for d in dists]}")

    # ─── 2. повторяющиеся блоки 16 КБ (крупные образы) ───
    print("\n" + "-" * 74)
    print("ПОВТОРЯЮЩИЕСЯ БЛОКИ 16 КБ (крупные образы)")
    print("-" * 74)
    BLK2 = 16384
    seen2 = defaultdict(list)
    for off in range(0, len(data) - BLK2 + 1, BLK2):
        h = hashlib.sha256(data[off : off + BLK2]).hexdigest()[:16]
        seen2[h].append(off)
    dups2 = {h: offs for h, offs in seen2.items() if len(offs) > 1}
    print(f"  блоков 16 КБ: {sum(len(o) for o in seen2.values())}, с повторами: {len(dups2)}")
    for h, offs in list(dups2.items())[:8]:
        print(f"    {h}  x{len(offs)}  @{[hex(o) for o in offs]}")

    # ─── 3. периодичность: ищем шаг, на котором много совпадений ───
    print("\n" + "-" * 74)
    print("ПЕРИОДИЧНОСТЬ: доля совпадающих байт при сдвиге на S")
    print("-" * 74)
    print("  (если файл — массив записей длины S, доля будет заметно выше 0)")

    def match_ratio(shift: int, sample: int = 65536) -> float:
        a = data[:sample]
        b = data[shift : shift + sample]
        n = min(len(a), len(b))
        if n <= 0:
            return 0.0
        same = sum(1 for i in range(n) if a[i] == b[i])
        return same / n

    # перебираем «круглые» шаги и несколько типичных размеров записей
    candidates = []
    for shift in list(range(64, 4097, 64)) + [
        8192, 16384, 32768, 65536, 0x10000, 0x18000, 0x20000,
        0x40000, 0x60000, 0x80000, 0xA0000, 0x100000,
    ]:
        if shift >= len(data):
            continue
        candidates.append((shift, match_ratio(shift)))

    candidates.sort(key=lambda x: -x[1])
    print("\n  топ-12 сдвигов по совпадению:")
    for shift, ratio in candidates[:12]:
        bar = "#" * int(ratio * 40)
        print(f"    0x{shift:06X} ({shift:8})  {ratio*100:5.2f}%  {bar}")

    # ─── 4. сколько уникальных байт ───
    print("\n" + "-" * 74)
    print("СОСТАВ ФАЙЛА")
    print("-" * 74)
    counts = Counter(data)
    top = counts.most_common(8)
    print("  самые частые байты:")
    for b, n in top:
        print(f"    0x{b:02X}  {n:7} раз  {n/len(data)*100:5.2f}%")
    print(f"  уникальных значений байта: {len(counts)} из 256")

    # ─── 5. первые 0x800 как структура ───
    print("\n" + "-" * 74)
    print("ПЕРВЫЕ 0x100 БАЙТ КАК 16-БАЙТОВЫЕ СТРОКИ")
    print("-" * 74)
    for off in range(0, 0x100, 16):
        row = data[off : off + 16]
        hx = " ".join(f"{b:02x}" for b in row)
        words = [int.from_bytes(row[i : i + 4], "little") for i in range(0, 16, 4)]
        wstr = "  ".join(f"{w:10}" for w in words)
        print(f"  {off:04X}  {hx}   |{wstr}")


if __name__ == "__main__":
    main()
